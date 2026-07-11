// filepath: coffee-app/mini-program/utils/api.js
// API 调用封装
// IMPORTANT: 不要在模块顶层调用 getApp()，因为此时 App 可能还未注册完成。
// 改为在每次调用时动态获取 app 实例。

function getApiBase() {
  // 优先从 global app 获取，否则用 fallback（开发者工具模拟器）
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.apiBase) {
      return app.globalData.apiBase;
    }
  } catch (e) {
    // getApp() 在 app.js 加载前调用会失败
  }
  return 'http://localhost:3000/api';
}

/**
 * Resolve a possibly-relative image URL to an absolute URL.
 * - "/uploads/xxx.png" → "http://192.168.1.29:3000/uploads/xxx.png"
 * - "http://..." → unchanged
 * - null/empty → null
 */
function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  // Relative URL: prefix with API host origin
  const apiBase = getApiBase();
  const origin = apiBase.replace(/\/api\/?$/, '');
  // url should start with /
  return origin + (url.startsWith('/') ? url : '/' + url);
}

function getApp_() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function request(url, method, data) {
  const token = wx.getStorageSync('session_token');
  const header = { 'Content-Type': 'application/json' };
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: getApiBase() + url,
      method,
      data,
      header,
      success: (res) => {
        if (res.statusCode === 401) {
          wx.removeStorageSync('session_token');
          const app = getApp_();
          if (app) app.globalData.openid = null;
          reject(new Error('请先登录'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data.error || `请求失败 ${res.statusCode}`));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络异常'))
    });
  });
}

/**
 * Login: exchange wx.login code for a session token.
 * Safe to call from app.js onLaunch (does not require getApp()).
 */
function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('wx.login failed'));
          return;
        }
        try {
          const res = await request('/sessions', 'POST', { code: loginRes.code });
          const { token, openid } = res.data;
          wx.setStorageSync('session_token', token);
          const app = getApp_();
          if (app) app.globalData.openid = openid;
          resolve({ token, openid });
        } catch (e) {
          reject(e);
        }
      },
      fail: reject
    });
  });
}

/**
 * Ensure we have a valid session, login if not.
 * Call this from page onLoad/onShow as needed.
 */
async function ensureLoggedIn() {
  let token = wx.getStorageSync('session_token');
  if (token) return token;
  const result = await login();
  return result.token;
}

function logout() {
  return new Promise((resolve) => {
    const token = wx.getStorageSync('session_token');
    if (token) {
      request('/sessions', 'DELETE').catch(() => {}).finally(() => {
        wx.removeStorageSync('session_token');
        const app = getApp_();
        if (app) app.globalData.openid = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  login,
  logout,
  ensureLoggedIn,
  resolveImageUrl,
  getApiBase,

  // 商品（公开接口）
  listProducts(params = {}) {
    const qs = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    return request(`/products${qs ? '?' + qs : ''}`, 'GET');
  },

  // 分类（公开接口）
  listCategories() {
    return request('/categories', 'GET');
  },

  // 订单（需要登录）
  // options: { customer_note?, customer_name?, customer_phone? }
  async createOrder(items, options = {}) {
    await ensureLoggedIn();
    const body = { items };
    if (options.customer_note) body.customer_note = options.customer_note;
    if (options.customer_name) body.customer_name = options.customer_name;
    if (options.customer_phone) body.customer_phone = options.customer_phone;
    return request('/orders', 'POST', body);
  },
  async getOrder(id) {
    await ensureLoggedIn();
    return request(`/orders/${id}`, 'GET');
  },
  async listOrders(status) {
    await ensureLoggedIn();
    return request(`/orders${status ? '?status=' + status : ''}`, 'GET');
  },
  async updateOrderStatus(id, status) {
    await ensureLoggedIn();
    return request(`/orders/${id}/status`, 'PATCH', { status });
  },

  // 模拟支付
  async mockPay(orderId) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '模拟支付',
        content: '本地开发环境：点击确定模拟支付成功',
        success: async (modalRes) => {
          if (modalRes.confirm) {
            try {
              await ensureLoggedIn();
              const result = await this.updateOrderStatus(orderId, 'paid');
              resolve(result);
            } catch (e) {
              wx.showToast({ title: '支付失败', icon: 'none' });
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      });
    });
  },

  // ─── 用户档案 ────────────────────────────────────
  // 获取当前用户资料
  //   includePhone=true 时，server 会在响应里附加真实手机号（user.phone），
  //   用于购物车自动填入取餐人信息。默认仅返回脱敏的 phone_masked。
  async getUserProfile(includePhone = false) {
    await ensureLoggedIn();
    const qs = includePhone ? '?include=phone' : '';
    return request(`/users/me${qs}`, 'GET');
  },

  // 更新昵称/头像
  async updateProfile(data) {
    await ensureLoggedIn();
    return request('/users/me', 'PATCH', data);
  },

  // 解密微信手机号：传入 getPhoneNumber 回调里的 encryptedData + iv
  async decryptPhone(encryptedData, iv) {
    await ensureLoggedIn();
    return request('/users/phone', 'POST', { encryptedData, iv });
  },

  // 手动设置手机号（开发 / 模拟器 / 备用，server 仅在非生产或显式开启时允许）
  async setPhonePlain(phone) {
    await ensureLoggedIn();
    return request('/users/phone-plain', 'POST', { phone });
  },

  // 解绑手机号
  async unbindPhone() {
    await ensureLoggedIn();
    return request('/users/me/phone', 'DELETE');
  }
};
