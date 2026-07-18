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
    hasDiscount: false,
    // 商品详情弹窗
    detailProduct: null,
    detailVisible: false,
    // 菜单顶部大图轮播
    banners: [],
    currentBannerIndex: 0,
    // ── v2 分组滚动联动 ──
    // groupedProducts: [{ id, category, categoryEn, items: [...] }]
    // 把全部分类 + 商品一次性整理好, 渲染到右侧长列表, 配合 scroll-into-view 跳转。
    groupedProducts: [],
    // scroll-into-view 绑定到这个变量。点击左侧 sidebar 时设置它,
    // 让 scroll-view 滚到对应分类标题。注意:赋值后即使内容不变也得重新触发, 因此
    // 每次切换都额外追加一个时间戳拼接到 anchor id 里 → _scrollAnchorSuffix。
    scrollIntoCategoryId: '',
    scrollWithAnimation: true,
    // ── v6: 左侧 sidebar 同步滚动 ──
    // 右侧分类变化时, 把左侧 sidebar-item 也滚到视口内, 避免高亮的条目跑到视口外。
    // 该值必须严格等于 WXML 中 sidebar-item 的 id (不带后缀)。
    scrollIntoSidebarId: '',
    // 当前可见的分类 (用于滚动时同步 sidebar 选中态)
    _lastScrollTop: 0
  },

  onLoad() {
    this.loadCategoriesAndProducts();
    this.loadBanners();
    api.ensureLoggedIn()
      .then(() => app.loadUserLevel())
      .then(() => this.applyLevelToView())
      .catch((e) => console.warn('Login:', e.message));
  },

  onShow() {
    this.refreshCart();
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
    this.applyDiscountToProducts();
  },

  // 给当前 products 列表加上 discounted_price, 同时重建分组
  applyDiscountToProducts() {
    const products = this.data.products.map((p) => ({
      ...p,
      discounted_price: app.priceWithDiscount(p.price),
      has_discount: app.priceWithDiscount(p.price) < p.price - 0.001
    }));
    this.setData({ products });
    this._rebuildGroups(products);
    // Refresh detail modal if open
    if (this.data.detailProduct) {
      const dp = this.data.detailProduct;
      const fresh = products.find((p) => p.id === dp.id);
      if (fresh) this.setData({ detailProduct: fresh });
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadCategoriesAndProducts(), this.loadBanners()]).finally(() =>
      wx.stopPullDownRefresh()
    );
  },

  async loadCategoriesAndProducts() {
    this.setData({ loading: true });
    try {
      const [catRes, prodRes] = await Promise.all([
        api.listCategories(),
        api.listProducts({ availableOnly: true })
      ]);

      const categories = catRes.data;
      const products = prodRes.data.map((p) => ({
        ...p,
        imageUrl: api.resolveImageUrl(p.image_url),
        icon: this.iconForCategory(p.category),
        discounted_price: app.priceWithDiscount(p.price),
        has_discount: app.priceWithDiscount(p.price) < p.price - 0.001,
        support_temperature: !!p.support_temperature
      }));

      // 默认选中第一个分类
      const activeCategory =
        this.data.activeCategory && categories.some((c) => c.name === this.data.activeCategory)
          ? this.data.activeCategory
          : (categories[0] ? categories[0].name : '');

      this.setData(
        {
          categories,
          products,
          activeCategory,
          loading: false
        },
        () => {
          // 构建 groupedProducts 后再设置初始 scroll-into-view。
          this._rebuildGroups(products);
          if (activeCategory) {
            // 同步初始 sidebar 位置 (默认分类高亮 + 滚动到可见)
            this._lastSyncedSidebarCategory = null;
            this._scrollSidebarToActive(activeCategory);
          }
        }
      );
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 把 products 按 categories 顺序分组, 每个组:
   *   { id, category, categoryEn, items: [...products] }
   * 注意: 商品的 category 是字符串 (来自 products.category), 我们用 categories 列表的顺序作为展示顺序,
   * 不属于任何分类的商品 (例如 category 被置 NULL) 会被忽略 (与之前行为一致)。
   */
  _rebuildGroups(products) {
    const cats = this.data.categories || [];
    const byCat = new Map();
    for (const c of cats) byCat.set(c.name, []);
    for (const p of products) {
      if (p.category && byCat.has(p.category)) {
        byCat.get(p.category).push(p);
      }
    }
    const groups = cats.map((c) => ({
      id: c.id,
      category: c.name,
      categoryEn: c.name_en,
      items: byCat.get(c.name) || []
    }));
    this.setData({ groupedProducts: groups }, () => {
      // 重建分组后, DOM 里 .cat-header 才刚渲染, 需要重新测量各分类标题位置
      // (onReady 调用一次后, 如果数据是异步返回, onReady 时还没有 .cat-header 节点)
      // 用 nextTick 等到布局完成后再测, 避免拿到旧坐标
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => this._measureGroupOffsets());
      } else {
        setTimeout(() => this._measureGroupOffsets(), 0);
      }
    });
  },

  /**
   * v5: 统一设置 activeCategory 的入口。
   * 所有需要同步选中态的路径都走这里 (点击 sidebar / 滚动联动 / 滑到底 / 轮播跳转)。
   * 这样 left sidebar 的同步滚动不会被遗漏。
   * 用 partialUpdate 避免整个 setData 重新渲染列表。
   */
  _setActiveCategory(categoryName) {
    if (!categoryName) return;
    if (this.data.activeCategory === categoryName) {
      // 即使同名, 仍调一次同步滚动, 处理 “首次加载” / “返回菜单页” 时需要重置侧边栏位置的场景
      this._scrollSidebarToActive(categoryName);
      return;
    }
    this.setData({ activeCategory: categoryName }, () => {
      this._scrollSidebarToActive(categoryName);
    });
  },

  /**
   * 工具: 滚动到指定分类标题。
   * 给 anchor id 拼一个递增后缀, 让 scroll-into-view 在内容不变的情况下也能重新触发。
   */
  _scrollToCategory(categoryName, withAnimation = true) {
    if (!categoryName) return;
    const cat = (this.data.categories || []).find((c) => c.name === categoryName);
    if (!cat) return;
    const targetId = `cat-header-${cat.id}`;
    // scroll-into-view 必须与 WXML 实际渲染的 id 严格一致 (无后缀)
    // 同一 id 重复 setData 会被小程序跳过, 用空串中转强制重新触发
    if (this.data.scrollIntoCategoryId === targetId) {
      this.setData({ scrollIntoCategoryId: '' });
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() =>
          this.setData({ scrollIntoCategoryId: targetId, scrollWithAnimation: withAnimation })
        );
      } else {
        setTimeout(
          () => this.setData({ scrollIntoCategoryId: targetId, scrollWithAnimation: withAnimation }),
          0
        );
      }
    } else {
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() =>
          this.setData({ scrollIntoCategoryId: targetId, scrollWithAnimation: withAnimation })
        );
      } else {
        setTimeout(
          () => this.setData({ scrollIntoCategoryId: targetId, scrollWithAnimation: withAnimation }),
          0
        );
      }
    }
  },

  /**
   * v6: 让左侧 sidebar 滚到使激活条目可见。
   *
   * 之前实现问题排查 (重要):
   *   - WXML 里 id 渲染为 `sidebar-item-<id>` (无后缀)
   *   - 但之前代码 setData 的是 `sidebar-item-<id>__<suffix>` 带后缀 → 永远找不到
   *     匹配元素, scroll-into-view 静默失败 → sidebar 不会跟随滑动
   *
   * v6 实现:
   *   - scroll-into-view 的值严格 = WXML 上渲染的 id (不带后缀)
   *   - 当需要重新触发同一 id 的滚动时: 先 setData 为空串, 下一帧再设回目标 id,
   *     强制小程序重新执行 scroll-into-view
   *   - 不去重、不节流: 用户的每一次主动跨分类都应当被同步
   *   - 使用 wx.nextTick 等到 DOM 渲染后再调用
   */
  _scrollSidebarToActive(categoryName) {
    if (!categoryName) return;
    const cat = (this.data.categories || []).find((c) => c.name === categoryName);
    if (!cat) return;
    const targetId = `sidebar-item-${cat.id}`;
    // 如果上一次同步的 id 与本次相同, 仍需要强制重新触发 (小程序 setData 相同值会被跳过)
    // 做法: 先 setData 为空串, 下一帧再设回 targetId
    if (this.data.scrollIntoSidebarId === targetId) {
      this.setData({ scrollIntoSidebarId: '' });
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => this.setData({ scrollIntoSidebarId: targetId }));
      } else {
        setTimeout(() => this.setData({ scrollIntoSidebarId: targetId }), 0);
      }
    } else {
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => this.setData({ scrollIntoSidebarId: targetId }));
      } else {
        setTimeout(() => this.setData({ scrollIntoSidebarId: targetId }), 0);
      }
    }
  },

  // 兼容旧接口: 是否当前分类下没有任何商品 (现用于保留扩展)
  _isEmptyForCategory(products, categoryName) {
    if (!categoryName) return true;
    return !products.some((p) => p.category === categoryName);
  },

  // 默认 emoji 图标
  iconForCategory(category) {
    if (category === '意式咖啡') return '☕';
    if (category === '创意特调') return '🍹';
    if (category === '其他饮品') return '🥤';
    return '🍵';
  },

  /**
   * 点击 sidebar 分类 → 滚动到该分类标题。
   * 同时立即把 activeCategory 设置为该分类 (sidebar 高亮立即跟随)。
   * 滚动结束时 bindscroll 仍会再次校准 (冗余保护)。
   */
  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this._setActiveCategory(key);
    this._scrollToCategory(key, true);
  },

  /**
   * 滚动事件 — 同步 sidebar 激活态。
   * 算法: 用 _lastScrollTop 与当前 scrollTop 比较, 只在用户主动向上滑动时重新计算,
   * 避免跳转动画过程中频繁更新。
   *
   * 实现: 找出当前 scrollTop 落在哪个分类标题区间内。
   * 因为 scroll-view 没有 querySelector API, 这里用一个近似方法:
   * 我们存了 _groupOffsets = [{ category, top }], top 是每个分类标题距离滚动区顶部的近似像素位置。
   * 由于商品卡片高度相对固定 (约 200rpx), 我们可以预估: 每个商品卡片 ~ 220rpx ≈ 110px。
   * 但为了精确, 我们在每个 cat-header 渲染后通过 boundingClientRect 来测量并缓存到 _groupOffsets。
   */
  onProductScroll(e) {
    const scrollTop = e.detail.scrollTop;
    // 用户只要实际滚动 (非零), 就标记为 “已主动交互”, 后续不再被初始定位覆盖
    if (scrollTop > 0) {
      this._userScrolledProductArea = true;
    }
    this._updateActiveCategoryByScrollTop(scrollTop);
  },

  _updateActiveCategoryByScrollTop(scrollTop) {
    const offsets = this._groupOffsets || [];
    if (offsets.length === 0) return;
    // 找到第一个 top > scrollTop 的前一个分类; 若所有都已过, 取最后一个。
    let current = offsets[0].category;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i].top <= scrollTop + 1) {
        current = offsets[i].category;
      } else {
        break;
      }
    }
    if (current !== this.data.activeCategory) {
      this._setActiveCategory(current);
    }
  },

  /**
   * 滑到底部 → 自动滚到下一个分类的标题。
   * 注意: bindscrolltolower 在用户主动滑到底时触发一次, 但在我们用 _scrollToCategory
   * 程序触发的滚动中, lower-threshold=0 也会触发一次。我们用 _ignoreNextScrollToLower 标志位
   * 跳过下一次触发 (区分"程序跳转"和"用户操作")。
   */
  onProductScrollToLower() {
    if (this._ignoreNextScrollToLower) {
      this._ignoreNextScrollToLower = false;
      return;
    }
    const cats = this.data.categories || [];
    if (cats.length === 0) return;
    const idx = cats.findIndex((c) => c.name === this.data.activeCategory);
    if (idx < 0 || idx >= cats.length - 1) return; // 已经在最后一个分类, 不再前进
    const next = cats[idx + 1];
    this._setActiveCategory(next.name);
    this._scrollToCategory(next.name, true);
    // 程序触发的滚动, 接下来的 scrolltolower 不应再次跳到再下一个
    this._ignoreNextScrollToLower = true;
  },

  /**
   * 点击分类大标题 (scroll-view 里的) → 等价于点击 sidebar,
   * 但这里一般用户很少直接点标题, 主要是冗余入口, 同时滚动到标题位置 (其实本来就在那里)。
   */
  onCatHeaderTap(e) {
    const category = e.currentTarget.dataset.category;
    if (!category) return;
    this._setActiveCategory(category);
  },

  // ─────────────────────────────────────────────────────────
  // 图片 / 轮播相关 (从 v1 保留)
  // ─────────────────────────────────────────────────────────

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const products = this.data.products.map((p) =>
      p.id === id ? { ...p, imageUrl: null } : p
    );
    this.setData({ products });
    this._rebuildGroups(products);
  },

  onProductImageTap(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return;
    if (!product.icon) product.icon = this.iconForCategory(product.category);
    const detailProduct = { ...product, options: {} };
    this.setData({ detailProduct, detailVisible: true });
  },

  onPickTemperature(e) {
    const temp = e.currentTarget.dataset.temp;
    const dp = this.data.detailProduct;
    if (!dp || !dp.support_temperature) return;
    this.setData({ 'detailProduct.options': { temperature: temp } });
  },

  closeDetail() {
    this.setData({ detailVisible: false });
  },

  addToCartFromDetail() {
    const product = this.data.detailProduct;
    if (!product) return;
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

  async addToCart(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find((p) => p.id === id);
    if (!product) return;
    if (product.support_temperature) {
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
  },

  // ─────────────────────────────────────────────────────────
  // 轮播图加载 / 错误 / 点击
  // ─────────────────────────────────────────────────────────

  async loadBanners() {
    try {
      const list = await api.listBanners();
      const banners = (list || []).map((b) => ({
        ...b,
        imageUrl: api.resolveImageUrl(b.image_url)
      }));
      this.setData({ banners, currentBannerIndex: 0 }, () => {
        // 首次进入页面 (用户尚未与右侧滚动区交互):
        //   - 有 banner: 滚到 banner-anchor, 让轮播完整展示在视口顶部
        //   - 无 banner: 滚到第一个分类标题 (保持旧的可用行为)
        // 后续用户主动交互 (点击 sidebar / 滚动 / 滑到底 / 轮播跳转分类) 不受影响。
        if (!this._userScrolledProductArea) {
          if (banners.length > 0) {
            this._scrollToBannerAnchor();
          } else if (this.data.activeCategory) {
            this._scrollToCategory(this.data.activeCategory, /* withAnimation */ false);
          }
        }
      });
    } catch (e) {
      console.warn('loadBanners failed:', e.message);
      this.setData({ banners: [] }, () => {
        // banner 接口失败 → 按 “无 banner” 处理, 滚到第一个分类
        if (!this._userScrolledProductArea && this.data.activeCategory) {
          this._scrollToCategory(this.data.activeCategory, /* withAnimation */ false);
        }
      });
    }
  },

  /**
   * 将右侧滚动区滚到 banner-anchor, 让轮播图从顶部开始展示。
   * scroll-into-view 只接受该 scroll-view 内部元素的 id, 这里直接给 id 字符串。
   * 由于这是初始定位 (scrollTop=0), 多数情况下不需要 scroll-into-view 也成立,
   * 但商品图片异步加载完成后 scroll-view 内容高度变化, 可能出现意外滚动,
   * 显式调用 scroll-into-view 锁定 scrollTop 到 banner 位置, 更稳妥。
   */
  _scrollToBannerAnchor() {
    const targetId = 'banner-anchor';
    if (this.data.scrollIntoCategoryId === targetId) {
      this.setData({ scrollIntoCategoryId: '' });
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => this.setData({ scrollIntoCategoryId: targetId }));
      } else {
        setTimeout(() => this.setData({ scrollIntoCategoryId: targetId }), 0);
      }
    } else {
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => this.setData({ scrollIntoCategoryId: targetId }));
      } else {
        setTimeout(() => this.setData({ scrollIntoCategoryId: targetId }), 0);
      }
    }
  },

  onBannerTap(e) {
    const ds = e.currentTarget.dataset || {};
    const id = ds.id;
    if (id == null) return;
    const banner = this.data.banners.find((b) => b.id === id);
    if (!banner) return;

    const linkType = banner.link_type || 'none';
    const linkValue = banner.link_value;

    if (linkType === 'category' && linkValue) {
      const exists = this.data.categories.some((c) => c.name === linkValue);
      if (!exists) {
        wx.showToast({ title: '该分类已下架', icon: 'none' });
        return;
      }
      this._setActiveCategory(linkValue);
      this._scrollToCategory(linkValue, true);
    } else if (linkType === 'product' && linkValue) {
      const pid = parseInt(linkValue, 10);
      const product = this.data.products.find((p) => p.id === pid);
      if (!product) {
        wx.showToast({ title: '该商品已下架', icon: 'none' });
        return;
      }
      if (!product.icon) product.icon = this.iconForCategory(product.category);
      this.setData({
        detailProduct: { ...product, options: {} },
        detailVisible: true
      });
    }
  },

  onBannerChange(e) {
    const detail = e.detail || {};
    if (typeof detail.current === 'number') {
      this.setData({ currentBannerIndex: detail.current });
    }
  },

  onBannerImageError(e) {
    const id = e.currentTarget.dataset.id;
    if (id == null) return;
    const banners = this.data.banners.filter((b) => b.id !== id);
    this.setData({ banners });
  },

  // ─────────────────────────────────────────────────────────
  // 页面显示后测量分类标题位置, 用于滚动联动
  // ─────────────────────────────────────────────────────────

  onReady() {
    // onReady 可能在 .cat-header 还没渲染时就触发 (数据是异步加载),
    // 真正可靠的位置测量由 _rebuildGroups 的 setData callback 完成。
    // 这里保险起见再调一次, 双保险。
    setTimeout(() => this._measureGroupOffsets(), 0);
  },

  /**
   * 测量每个分类标题距离 .product-area 滚动区顶部的位置。
   * 写入 this._groupOffsets = [{ category, top }, ...]
   *
   * 调用时机:
   *   - _rebuildGroups 的 setData callback (主要, 保证 .cat-header 已渲染)
   *   - onReady 双保险
   */
  _measureGroupOffsets() {
    const query = wx.createSelectorQuery();
    query.select('.product-area').boundingClientRect();
    query.selectAll('.cat-header').boundingClientRect();
    query.exec((res) => {
      if (!res || res.length < 2) return;
      const containerRect = res[0];
      const headerRects = res[1] || [];
      if (!containerRect || !headerRects.length) {
        // 如果一次拿不到 (节点还没渲染完), 下一帧重试一次
        setTimeout(() => this._measureGroupOffsets(), 100);
        return;
      }
      // header.top - container.top 即该分类标题相对滚动区顶部的初始距离
      const offsets = headerRects.map((rect) => {
        const cat = (this.data.groupedProducts || []).find(
          (g) => `cat-header-${g.id}` === rect.id
        );
        return {
          category: cat ? cat.category : '',
          top: rect.top - containerRect.top
        };
      }).filter((x) => x.category);
      this._groupOffsets = offsets;
    });
  }
});