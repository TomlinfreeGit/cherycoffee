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

    // 初始化标志：onLaunch 是否完成
    ready: false
  },

  onLaunch() {
    // 恢复购物车
    const cart = wx.getStorageSync('cart');
    if (cart) this.globalData.cart = cart;

    // 自动检测环境：在真机上使用 LAN IP（如果 localhost 不可达）
    this.detectApiHost();

    // 标记启动完成
    this.globalData.ready = true;
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
  addToCart(product) {
    const existing = this.globalData.cart.find(
      (item) => item.product_id === product.id
    );
    if (existing) {
      existing.quantity += 1;
    } else {
      this.globalData.cart.push({
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        image_url: product.image_url || null,
        quantity: 1
      });
    }
    this.saveCart();
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
  }
});
