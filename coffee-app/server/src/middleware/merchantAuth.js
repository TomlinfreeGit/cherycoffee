// filepath: coffee-app/server/src/middleware/merchantAuth.js
// Merchant auth: simple bearer token check.
// In production, use proper signed JWTs.
const VALID_TOKENS = new Set([
  'merchant-local-token',  // For local dev
  process.env.MERCHANT_TOKEN
].filter(Boolean));

function merchantAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized. Merchant token required.' });
  }

  next();
}

module.exports = { merchantAuth };
