// filepath: coffee-app/mini-program/pages/menu/menu.js
const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    categories: [],
    activeCategory: '',
    products: [],
    loading: true,
    cartCount: 0,
    cartTotal: '0.00',
    // 会员等级相关
    userLevel: 1,
    discount: 1.0,
    hasDiscount: false, // level>1 时为 true
    // 商品详情弹窗
    detailProduct: null,
    detailVisible: false
  },

  onLoad() {
    this.loadCategoriesAndProducts();
    api.ensureLoggedIn()
      .then(() => app.loadUserLevel())
      .then(() => this.applyLevelToView())
      .catch((e) => console.warn('Login:', e.message));
  },

  onShow() {
    this.refreshCart();
    // 用户在其他页完成订单后级别提升，重新拉一次
    if (wx.getStorageSync('session_token')) {
      app.loadUserLevel().then(() => this.applyLevelToView());
    }
  },

  applyLevelToView() {
    this.setData({
      userLevel: app.globalData.level || 1,
      discount: app.globalData.discount || 1.0,
      hasDiscount: (app.globalData.discount || 1.0) < 0.999
    });
    // Refresh displayed product prices
    this.applyDiscountToProducts();
  },

  // 给当前 products 列表加上 discounted_price
  applyDiscountToProducts() {
    const products = this.data.products.map((p) => ({
      ...p,
      discounted_price: app.priceWithDiscount(p.price),
      has_discount: app.priceWithDiscount(p.price) < p.price - 0.001
    }));
    this.setData({ products });
    // Also refresh the detail modal if open
    if (this.data.detailProduct) {
      const dp = this.data.detailProduct;
      const fresh = products.find((p) => p.id === dp.id);
      if (fresh) this.setData({ detailProduct: fresh });
    }
  },

  onPullDownRefresh() {
    this.loadCategoriesAndProducts().then(() => wx.stopPullDownRefresh());
  },

  async loadCategoriesAndProducts() {
    this.setData({ loading: true });
    try {
      const [catRes, prodRes] = await Promise.all([
        api.listCategories(),
        api.listProducts({ availableOnly: true })
      ]);

      const categories = catRes.data;
      // 先把服务端原始字段拷过来,再叠上 imageUrl/icon/折扣字段。
      // 注意:必须在这里调 priceWithDiscount() 给每件商品加上
      // discounted_price + has_discount,WXML 直接读这两个字段,
      // 漏掉它们会让价格显示为空(典型场景:下拉刷新后)。
      const products = prodRes.data.map((p) => ({
        ...p,
        imageUrl: api.resolveImageUrl(p.image_url),
        icon: this.iconForCategory(p.category),
        discounted_price: app.priceWithDiscount(p.price),
        has_discount: app.priceWithDiscount(p.price) < p.price - 0.001,
        // 把后端的 0/1 归一化成布尔,前端更直观
        support_temperature: !!p.support_temperature
      }));

      // 默认选中第一个分类(若当前已选中且仍存在则保留)
      const activeCategory =
        this.data.activeCategory && categories.some((c) => c.name === this.data.activeCategory)
          ? this.data.activeCategory
          : (categories[0] ? categories[0].name : '');

      this.setData({
        categories,
        products,
        activeCategory,
        activeCategoryEmpty: this._isEmptyForCategory(products, activeCategory),
        loading: false
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 是否当前分类下没有任何商品
  _isEmptyForCategory(products, categoryName) {
    if (!categoryName) return true;
    return !products.some((p) => p.category === categoryName);
  },

  // 默认 emoji 图标(分类没设置 icon 时使用)
  iconForCategory(category) {
    if (category === '意式咖啡') return '☕';
    if (category === '创意特调') return '🍹';
    if (category === '其他饮品') return '🥤';
    return '🍵';
  },

  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.activeCategory) return;
    this.setData({
      activeCategory: key,
      activeCategoryEmpty: this._isEmptyForCategory(this.data.products, key)
    });
  },

  // 直接渲染 wx:if 进行过滤(比 computed 更可靠)
  isActiveCategory(product) {
    return product.category === this.data.activeCategory;
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const products = this.data.products.map((p) =>
      p.id === id ? { ...p, imageUrl: null } : p
    );
    this.setData({ products });
  },

  // 点击商品图片:弹出详情
  onProductImageTap(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return;
    // Ensure detailProduct has an icon fallback
    if (!product.icon) product.icon = this.iconForCategory(product.category);
    // 详情弹窗里始终展示 options 字段 (未选时为空对象)
    const detailProduct = { ...product, options: {} };
    this.setData({
      detailProduct,
      detailVisible: true
    });
  },

  // 选择冷/热 (仅当商品开启 support_temperature 时)
  onPickTemperature(e) {
    const temp = e.currentTarget.dataset.temp;
    const dp = this.data.detailProduct;
    if (!dp || !dp.support_temperature) return;
    this.setData({
      'detailProduct.options': { temperature: temp }
    });
  },

  // 关闭详情
  closeDetail() {
    this.setData({ detailVisible: false });
  },

  // 从详情弹窗加购
  addToCartFromDetail() {
    const product = this.data.detailProduct;
    if (!product) return;

    // 必选温度但未选 → 拦截,提示用户
    if (product.support_temperature && !(product.options && product.options.temperature)) {
      wx.showToast({ title: '请先选择温度', icon: 'none' });
      return;
    }

    app.addToCart(product);
    wx.vibrateShort({ type: 'light' });
    const tempLabel = (product.options && product.options.temperature) || '';
    wx.showToast({
      title: tempLabel ? `已加入 ${tempLabel} ${product.name}` : `已加入 ${product.name}`,
      icon: 'success',
      duration: 1200
    });

    this.setData({ detailVisible: false });
    this.refreshCart();
  },

  // 内联加购(列表页的 + 按钮)
  // 对于支持冷/热的商品,直接打开详情弹窗让用户先选温度,避免误加。
  async addToCart(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return;

    if (product.support_temperature) {
      // 复用详情弹窗的同一路径,选好温度后再次点 + 加入购物车
      if (!product.icon) product.icon = this.iconForCategory(product.category);
      this.setData({
        detailProduct: { ...product, options: {} },
        detailVisible: true
      });
      return;
    }

    app.addToCart(product);
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
    // Apply current level discount to the cart total too, so what the
    // user sees in the bottom-bar matches what they'll pay at checkout.
    const total = cart.reduce(
      (sum, item) => sum + app.priceWithDiscount(item.price) * item.quantity,
      0
    );
    this.setData({
      cartCount: count,
      cartTotal: total.toFixed(2)
    });
  },

  goToCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  }
});