// filepath: coffee-app/mini-program/pages/menu/menu.js
const app = getApp();
const api = require('../../utils/api.js');
const { formatDate } = require('../../utils/format.js');

const CATEGORIES = [
  { key: '意式咖啡', label: '意式咖啡' },
  { key: '其他饮品', label: '其他饮品' },
  { key: '创意特调', label: '创意特调' }
];

Page({
  data: {
    categories: CATEGORIES,
    activeCategory: '意式咖啡',
    products: [],
    loading: true,
    cartCount: 0,
    cartTotal: '0.00'
  },

  onLoad() {
    this.loadProducts();
    // 静默登录（在加载商品后异步进行）
    api.ensureLoggedIn().catch((e) => console.warn('Login:', e.message));
  },

  onShow() {
    this.refreshCart();
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadProducts().then(() => wx.stopPullDownRefresh());
  },

  async loadProducts() {
    this.setData({ loading: true });
    try {
      const res = await api.listProducts({ availableOnly: true });
      // Resolve image URLs to absolute paths so <image> can display them
      const products = res.data.map((p) => ({
        ...p,
        imageUrl: api.resolveImageUrl(p.image_url),
        emoji: this.emojiForCategory(p.category)
      }));
      this.setData({ products });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // Fallback emoji for products without images
  emojiForCategory(category) {
    if (category === '意式咖啡') return '☕';
    if (category === '创意特调') return '🍹';
    return '🥤';
  },

  // 切换分类
  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeCategory: key });
  },

  // 图片加载失败：清除 imageUrl，fallback 到 emoji
  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const products = this.data.products.map((p) =>
      p.id === id ? { ...p, imageUrl: null } : p
    );
    this.setData({ products });
  },

  // 添加到购物车
  async addToCart(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return;

    app.addToCart(product);

    // 触觉反馈
    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: `已加入 ${product.name}`,
      icon: 'success',
      duration: 1200
    });

    this.refreshCart();
  },

  refreshCart() {
    const cart = app.globalData.cart;
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    this.setData({
      cartCount: count,
      cartTotal: total.toFixed(2)
    });
  },

  goToCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  }
});
