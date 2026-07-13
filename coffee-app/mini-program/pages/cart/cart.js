// filepath: coffee-app/mini-program/pages/cart/cart.js
const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    cart: [],
    total: '0.00',
    originalTotal: '0.00',  // 折扣前的总价（用于划线展示）
    saved: '0.00',          // 优惠金额
    hasDiscount: false,     // 是否真的享受折扣
    userLevel: 1,
    note: '',
    customerName: '',
    customerPhone: '',
    submitting: false,
    // Profile state
    isLoggedIn: false,
    hasServerProfile: false,
    loadingProfile: true
  },

  onShow() {
    // 拉一次最新等级（用户可能刚从其他页完成订单升级）
    if (wx.getStorageSync('session_token')) {
      app.loadUserLevel().then(() => {
        this.refreshCart();
        this.checkLoginAndLoadProfile();
      });
    } else {
      this.refreshCart();
      this.checkLoginAndLoadProfile();
    }
  },

  // ─── 取餐人信息：仅从服务器填充，不读本地缓存 ────────────
  // 用户点击购物车时，若已登录，自动从 /api/users/me 拉取昵称和真实手机号
  // 并填入表单。若未登录或未绑手机，显示"完善我的资料信息"引导卡片。
  async checkLoginAndLoadProfile() {
    this.setData({ loadingProfile: true });
    const token = wx.getStorageSync('session_token');
    if (!token) {
      this.setData({
        isLoggedIn: false,
        hasServerProfile: false,
        loadingProfile: false
      });
      return;
    }

    // 已有 token，验证是否仍有效 + 拉资料
    try {
      const res = await api.getUserProfile(true); // include=phone → 真实手机号
      const profile = res.data;
      const updates = {
        isLoggedIn: true,
        hasServerProfile: !!(profile.nickname && profile.phone),
        loadingProfile: false
      };

      // 自动填入（仅当表单为空，避免覆盖用户已编辑的内容）
      if (!this.data.customerName && profile.nickname) {
        updates.customerName = profile.nickname;
      }
      if (!this.data.customerPhone && profile.phone && /^1[3-9]\d{9}$/.test(profile.phone)) {
        updates.customerPhone = profile.phone;
      }
      this.setData(updates);
    } catch (e) {
      // token 可能过期（401 由 api.request 拦截并清掉 storage）
      this.setData({
        isLoggedIn: false,
        hasServerProfile: false,
        loadingProfile: false
      });
      // 不弹错误 —— 静默回退到引导卡片
    }
  },

  refreshCart() {
    const cart = app.globalData.cart;
    const discount = app.globalData.discount || 1.0;
    let originalTotal = 0;
    let discountedTotal = 0;

    const cartWithImages = cart.map((item) => {
      const orig = Number(item.price) * item.quantity;
      const discounted = app.priceWithDiscount(item.price) * item.quantity;
      originalTotal += orig;
      discountedTotal += discounted;
      // 归一化 options:旧购物车(没有 options 字段)渲染为空对象,UI 安全兜底
      const options = (item.options && typeof item.options === 'object') ? item.options : {};
      return {
        ...item,
        options,
        imageUrl: api.resolveImageUrl(item.image_url),
        unit_price_discounted: app.priceWithDiscount(item.price),
        subtotal_discounted: Math.round(discounted * 100) / 100,
        has_discount: discount < 0.999
      };
    });

    const hasDiscount = discount < 0.999 && originalTotal - discountedTotal > 0.001;
    this.setData({
      cart: cartWithImages,
      total: discountedTotal.toFixed(2),
      originalTotal: originalTotal.toFixed(2),
      saved: Math.max(0, originalTotal - discountedTotal).toFixed(2),
      hasDiscount,
      userLevel: app.globalData.level || 1
    });
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const cart = this.data.cart.map((item) =>
      item.product_id === id ? { ...item, imageUrl: null } : item
    );
    this.setData({ cart });
  },

  // 增加数量
  increase(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.cart.find((i) => i.product_id === id);
    if (item) {
      item.quantity += 1;
      app.saveCart();
      this.refreshCart();
    }
  },

  // 减少数量
  decrease(e) {
    const id = e.currentTarget.dataset.id;
    const idx = this.data.cart.findIndex((i) => i.product_id === id);
    if (idx >= 0) {
      const item = this.data.cart[idx];
      if (item.quantity <= 1) {
        app.removeFromCart(id);
      } else {
        item.quantity -= 1;
        app.saveCart();
      }
      this.refreshCart();
    }
  },

  // 删除
  deleteItem(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.cart.find((i) => i.product_id === id);
    wx.showModal({
      title: '提示',
      content: `确定从购物车移除「${item ? item.product_name : '该商品'}」？`,
      success: (res) => {
        if (res.confirm) {
          app.removeFromCart(id);
          this.refreshCart();
        }
      }
    });
  },

  // 备注输入
  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  onNameInput(e) {
    this.setData({ customerName: e.detail.value });
  },

  onPhoneInput(e) {
    const value = (e.detail.value || '').replace(/\D/g, '').slice(0, 11);
    this.setData({ customerPhone: value });
  },

  // 去我的资料页（未登录或未绑定手机号时引导）
  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // 提交订单
  async submit() {
    if (this.data.cart.length === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' });
      return;
    }

    const name = (this.data.customerName || '').trim();
    const phone = this.data.customerPhone || '';
    if (!name) {
      wx.showToast({ title: '请输入您的姓名', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入有效的手机号', icon: 'none' });
      return;
    }

    if (this.data.submitting) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const items = this.data.cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        // 把购物车里的 options 透传给后端;后端会校验它与商品是否匹配
        options: (item.options && item.options.temperature) ? { temperature: item.options.temperature } : undefined
      }));

      const orderRes = await api.createOrder(items, {
        customer_note: this.data.note || undefined,
        customer_name: name,
        customer_phone: phone
      });
      const order = orderRes.data;

      // 拉起微信支付。Mock 模式 (paySign==='mock') 会在 requestWxPayment 内部弹窗模拟;
      // Real 模式: 服务端调用 V3 统一下单,回调前订单保持 pending。
      wx.showLoading({ title: '拉起支付...', mask: true });
      try {
        await api.payOrder(order.id);
        // 支付调用发起成功 → 清空购物车,跳成功页 (成功页会每 10s 拉一次订单最新状态,
        // 真实支付模式下,等后端回调更新 status='paid' 后,UI 自然刷新为"已支付"。)
        app.clearCart();
        wx.hideLoading();
        wx.redirectTo({
          url: `/pages/order-success/order-success?id=${order.id}`
        });
      } catch (payErr) {
        wx.hideLoading();
        if (payErr.code === 'CANCEL') {
          // 用户在支付弹窗点击"取消" → 保留购物车 → 跳订单详情,用户可"继续支付"或"取消订单"
          this.setData({ submitting: false });
          wx.redirectTo({
            url: `/pages/order-detail/order-detail?id=${order.id}`
          });
        } else {
          this.setData({ submitting: false });
          wx.showModal({
            title: '支付失败',
            content: payErr.message || '请稍后再试',
            showCancel: false
          });
        }
      }
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({
        title: '下单失败',
        content: e.message || '请稍后重试',
        showCancel: false
      });
    }
  },

  goToMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  }
});
