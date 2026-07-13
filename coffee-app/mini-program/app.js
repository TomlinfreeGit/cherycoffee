// filepath: coffee-app/mini-program/app.js
// app.js - 小程序入口

// API 地址自动检测：
// - 模拟器：使用 localhost
// - 真机调试：需要电脑局域网 IP（修改 LAN_API_HOST）
//
// 真机调试前请修改 LAN_API_HOST 为你电脑的局域网 IP（运行 ipconfig 查看），
// 或在开发者工具中设置"不校验合法域名"并手动指定 API 地址。
const DEV_API_HOST = 'http://localhost:3000/api';
const LAN_API_HOST = 'https://rpi.tomlinfree.dpdns.org/api';  // ← 真机调试前改这里

App({
  globalData: {
    // 默认使用 localhost，开发者可在 onLaunch 时通过环境判断修改
    apiBase: LAN_API_HOST,

    // 购物车
    cart: [],

    // 用户 openid（从 session 获取）
    openid: null,

    // 会员等级 + 折扣参数（启动后从 /api/settings + /api/users/me 填充）
    // discount 是折扣倍率：level 1 = 1.00（不打折），level 2 = 0.99 ...
    level: 1,
    discount: 1.0, // 0.80–1.00
    completedOrders: 0,
    nextLevelOrders: 10, // 还差几单升一级
    nextLevelThreshold: 10, // 每 N 单升一级

    // 初始化标志：onLaunch 是否完成
    ready: false
  },

  onLaunch() {
    // 恢复购物车
    const cart = wx.getStorageSync('cart');
    if (cart) this.globalData.cart = cart;

    // 自动检测环境：在真机上使用 LAN IP（如果 localhost 不可达）
    this.detectApiHost();

    // 异步预取公开设置（不阻塞启动）
    this.loadSettings();

    // 标记启动完成
    this.globalData.ready = true;
  },

  // 预取系统设置（会员等级 + 折扣参数）
  loadSettings() {
    const api = require('./utils/api.js');
    api.getSettings()
      .then((res) => {
        const s = res.data || {};
        if (typeof s.level_orders_required === 'number') {
          this.globalData.nextLevelThreshold = s.level_orders_required;
        }
      })
      .catch((e) => console.warn('loadSettings:', e.message));
  },

  // 拉取当前用户等级信息 (登录后调用)
  async loadUserLevel() {
    const api = require('./utils/api.js');
    try {
      const res = await api.getUserProfile({ includeLevel: true });
      const d = res.data || {};
      this.globalData.level = d.level || 1;
      this.globalData.discount = typeof d.discount === 'number' ? d.discount : 1.0;
      this.globalData.completedOrders = d.completed_orders || 0;
      this.globalData.nextLevelOrders = d.next_level_orders || this.globalData.nextLevelThreshold;
      this.globalData.nextLevelThreshold = d.next_level_threshold || this.globalData.nextLevelThreshold;
    } catch (e) {
      // 没登录或网络错误时静默忽略（默认 level=1）
    }
  },

  // 检测 API 主机：先试 localhost，失败后回退到 LAN IP
  detectApiHost() {
    const candidates = [DEV_API_HOST, LAN_API_HOST];

    const tryOne = (i) => {
      if (i >= candidates.length) return;
      const url = candidates[i] + '/health';
      wx.request({
        url,
        method: 'GET',
        timeout: 2000,
        success: (res) => {
          if (res.statusCode === 200) {
            this.globalData.apiBase = candidates[i];
            console.log('API host:', candidates[i]);
          } else {
            tryOne(i + 1);
          }
        },
        fail: () => tryOne(i + 1)
      });
    };

    tryOne(0);
  },

  // 静默登录 - 在页面 onShow/onLoad 中按需调用
  silentLogin() {
    const api = require('./utils/api.js');
    return api.login().catch((e) => {
      console.warn('Silent login failed:', e.message);
    });
  },

  // 保存购物车到本地
  saveCart() {
    wx.setStorageSync('cart', this.globalData.cart);
  },

  // 添加商品到购物车
  // 同一商品在不同 options 下应该作为两条购物车条目 (例如 热拿铁 与 冰拿铁 各一)。
  // product 必填字段: id, name, price, options?: { temperature?: '热' | '冷' | null }
  addToCart(product) {
    const opts = (product.options && typeof product.options === 'object') ? product.options : {};
    // 归一化:空对象当作 null,便于相等比较
    const normalizedOptions = (opts.temperature) ? { temperature: opts.temperature } : null;
    const existing = this.globalData.cart.find(
      (item) => item.product_id === product.id && this._sameOptions(item.options, normalizedOptions)
    );
    if (existing) {
      existing.quantity += 1;
    } else {
      this.globalData.cart.push({
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        image_url: product.image_url || null,
        quantity: 1,
        options: normalizedOptions
      });
    }
    this.saveCart();
  },

  // 比较两个 options 对象是否等价 (都视为 null 等价于 {})
  _sameOptions(a, b) {
    const norm = (o) => {
      if (!o) return null;
      const t = o.temperature;
      if (!t) return null;
      return { temperature: t };
    };
    const na = norm(a);
    const nb = norm(b);
    if (na === null && nb === null) return true;
    if (na === null || nb === null) return false;
    return na.temperature === nb.temperature;
  },

  // 从购物车移除
  removeFromCart(productId) {
    this.globalData.cart = this.globalData.cart.filter(
      (item) => item.product_id !== productId
    );
    this.saveCart();
  },

  // 清空购物车
  clearCart() {
    this.globalData.cart = [];
    this.saveCart();
  },

  // 计算折扣后价格（基于 globalData.discount 倍率）
  // discount=1.00 → 返回原价（无折扣）
  // discount=0.99 → 返回原价的 99%
  priceWithDiscount(originalPrice) {
    const d = this.globalData.discount || 1.0;
    const rounded = Math.round(originalPrice * d * 100) / 100;
    return rounded;
  },

  // 原价（保留2位小数，用于划线展示）
  priceWithoutDiscount(originalPrice) {
    return Math.round(Number(originalPrice) * 100) / 100;
  }
});
