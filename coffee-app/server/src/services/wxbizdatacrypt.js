// filepath: coffee-app/server/src/services/wxbizdatacrypt.js
// WeChat Mini-Program encrypted data decryption.
//
// Reference: https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/signature.html
//
// Algorithm:
//   1. AES-128-CBC decrypt the encryptedData using session_key as the key.
//      The IV is the first 16 bytes of the decoded data (which is base64-decoded).
//   2. Discard the first 16 random bytes (PKCS#7 padding bytes are stripped automatically).
//   3. The remaining JSON is the plaintext.
//
// The plain JSON includes:
//   - openId, unionId
//   - nickName, gender, language, city, province, country, avatarUrl
//   - For phone numbers: phoneNumber, purePhoneNumber, countryCode, watermark

const crypto = require('node:crypto');

/**
 * Decrypt WeChat encrypted data.
 * @param {string} sessionKey - from jscode2session
 * @param {string} encryptedData - base64 string from client
 * @param {string} iv - base64 string from client
 * @returns {object} decrypted JSON
 */
function decryptData(sessionKey, encryptedData, iv) {
  if (!sessionKey) throw new Error('Missing sessionKey');
  if (!encryptedData) throw new Error('Missing encryptedData');
  if (!iv) throw new Error('Missing iv');

  let sessionKeyBuf, encryptedDataBuf, ivBuf;
  try {
    sessionKeyBuf = Buffer.from(sessionKey, 'base64');
    encryptedDataBuf = Buffer.from(encryptedData, 'base64');
    ivBuf = Buffer.from(iv, 'base64');
  } catch (e) {
    throw new Error(`Invalid base64 input: ${e.message}`);
  }

  if (sessionKeyBuf.length !== 16) {
    throw new Error(`Invalid sessionKey length: ${sessionKeyBuf.length} (expected 16)`);
  }
  if (ivBuf.length !== 16) {
    throw new Error(`Invalid IV length: ${ivBuf.length} (expected 16)`);
  }

  let decrypted;
  try {
    decrypted = crypto.createDecipheriv('aes-128-cbc', sessionKeyBuf, ivBuf);
    // PKCS#7 padding is handled automatically by setting autoPadding=true (default)
    decrypted.setAutoPadding(true);
    const result = Buffer.concat([decrypted.update(encryptedDataBuf), decrypted.final()]);
    const plain = result.toString('utf8');
    return JSON.parse(plain);
  } catch (e) {
    // Most common cause: session_key has rotated since client got the encryptedData.
    // Client must re-login and re-fetch the encryptedData.
    const err = new Error(`Failed to decrypt WeChat data: ${e.message}. ` +
      `This usually means session_key has rotated - ask the user to re-login.`);
    err.decryptError = true;
    throw err;
  }
}

/**
 * Decrypt phone number data.
 * Returns { phoneNumber, purePhoneNumber, countryCode } or throws.
 */
function decryptPhone(sessionKey, encryptedData, iv) {
  const data = decryptData(sessionKey, encryptedData, iv);
  return {
    phoneNumber: data.phoneNumber || null,
    purePhoneNumber: data.purePhoneNumber || null,
    countryCode: data.countryCode || '86',
    openid: data.openId || null,
    watermark: data.watermark || null
  };
}

module.exports = { decryptData, decryptPhone };
