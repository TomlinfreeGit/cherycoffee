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

  // 菜单顶部大图轮播 (公开接口)。
  // 返回启用的 banners (按 sort_order 升序),后端只返回 enabled=1 的行。
  // 失败时 resolve([]) — 轮播是装饰性元素,加载失败不应该阻塞菜单展示。
  async listBanners() {
    try {
      const res = await request('/banners', 'GET');
      return res.data || [];
    } catch (e) {
      console.warn('listBanners failed:', e.message);
      return [];
    }
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
  async listOrders(params) {
    await ensureLoggedIn();
    // Backwards-compatible: passing a string is treated as `status`.
    let q = {};
    if (typeof params === 'string') {
      q = { status: params };
    } else if (params && typeof params === 'object') {
      q = params;
    }
    const qs = Object.keys(q)
      .filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '')
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`)
      .join('&');
    return request(`/orders${qs ? '?' + qs : ''}`, 'GET');
  },
  async updateOrderStatus(id, status) {
    await ensureLoggedIn();
    return request(`/orders/${id}/status`, 'PATCH', { status });
  },

  // ─── 支付 ────────────────────────────────────────
  // 调后端 /orders/:id/pay 拿到拉起支付所需的签名参数。
  //   data.mode  : 'mock' | 'real'
  //   data.paySign === 'mock' → 后端未配置商户号,前端走弹窗模拟
  //   data.paySign 为真签名字符串 → 真签名的 V3 / V2 paySign
  async preparePayParams(orderId) {
    await ensureLoggedIn();
    const res = await request(`/orders/${orderId}/pay`, 'POST', {});
    return res.data;
  },

  // 拉起微信支付,成功 resolve,用户取消 reject(err.code='CANCEL')。
  // Mock 模式: 弹窗确认,不走 wx.requestPayment。
  requestWxPayment(params) {
    return new Promise((resolve, reject) => {
      if (params && params.paySign === 'mock') {
        wx.showModal({
          title: '模拟支付',
          content: '本地开发模式:点击确定模拟支付成功,取消则不支付',
          success: (modalRes) => {
            if (modalRes.confirm) resolve({ mock: true });
            else {
              const e = new Error('支付已取消');
              e.code = 'CANCEL';
              reject(e);
            }
          },
          fail: () => reject(new Error('模拟弹窗失败'))
        });
        return;
      }
      wx.requestPayment({
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign,
        success: (res) => resolve(res),
        fail: (err) => {
          const msg = (err && err.errMsg) || '支付失败';
          const e = new Error(msg);
          e.code = msg.includes('cancel') ? 'CANCEL' : 'FAIL';
          e.raw = err;
          reject(e);
        }
      });
    });
  },

  // 一站式支付: 准备参数 → 拉起支付。
  //   成功 resolve(params);用户取消 reject('支付已取消');系统错误 reject(msg)。
  //   后端真实模式下,成功后会异步通过回调更新订单 status='paid',前端需要在
  //   onShow/轮询中拉一次 getOrder 同步状态。
  async payOrder(orderId) {
    const params = await this.preparePayParams(orderId);
    await this.requestWxPayment(params);
    return params;
  },

  // ─── 用户档案 ────────────────────────────────────
  // 获取当前用户资料
  //   includePhone=true 时，server 会在响应里附加真实手机号（user.phone），
  //   用于购物车自动填入取餐人信息。默认仅返回脱敏的 phone_masked。
  //   includeLevel=true 时，server 会在响应里附加 level / completed_orders /
  //   discount / next_level_orders / next_level_threshold。
  //   两者可以同时传。
  //   兼容旧调用: getUserProfile(true) 也会当作 includePhone=true。
  async getUserProfile(options = {}) {
    let includePhone = false;
    let includeLevel = false;
    if (typeof options === 'boolean') {
      // Backwards-compatible: positional boolean
      includePhone = options;
    } else if (options && typeof options === 'object') {
      includePhone = !!options.includePhone;
      includeLevel = !!options.includeLevel;
    }
    await ensureLoggedIn();
    const parts = [];
    if (includePhone) parts.push('phone');
    if (includeLevel) parts.push('level');
    const qs = parts.length ? '?include=' + parts.join(',') : '';
    return request(`/users/me${qs}`, 'GET');
  },

  // 获取公开的系统设置 (会员等级、折扣参数)
  async getSettings() {
    return request('/settings', 'GET');
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
