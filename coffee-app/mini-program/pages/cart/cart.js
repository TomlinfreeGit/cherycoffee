// filepath: coffee-app/mini-program/pages/cart/cart.js
const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    cart: [],
    total: '0.00',
    note: '',
    customerName: '',
    customerPhone: '',
    submitting: false,
    savedProfile: null,
    serverProfile: null
  },

  onShow() {
    this.refreshCart();
    this.restoreProfile();
    this.loadServerProfile();
  },

  // Restore name/phone from last order (saved to local storage).
  // Server profile (from /api/users/me) takes priority since it's authoritative.
  restoreProfile() {
    const serverProfile = this.data.serverProfile;
    if (serverProfile) {
      if (!this.data.customerName && serverProfile.nickname) {
        this.setData({ customerName: serverProfile.nickname });
      }
      if (!this.data.customerPhone && serverProfile.phone) {
        this.setData({ customerPhone: serverProfile.phone });
      }
      return;
    }
    const saved = wx.getStorageSync('customer_profile');
    if (saved && !this.data.customerName && !this.data.customerPhone) {
      this.setData({
        customerName: saved.name || '',
        customerPhone: saved.phone || '',
        savedProfile: saved
      });
    }
  },

  // Pull the authoritative profile from the server (with the real phone number
  // so the cart can auto-fill both 取餐人姓名 and 手机号). Silently fails if
  // the user isn't logged in.
  async loadServerProfile() {
    try {
      const res = await api.getUserProfile(true); // include=phone → real phone
      const profile = res.data;
      this.setData({ serverProfile: profile });

      // If the form is still empty, auto-fill with the server profile
      const updates = {};
      if (!this.data.customerName && profile.nickname) {
        updates.customerName = profile.nickname;
      }
      if (!this.data.customerPhone) {
        // Prefer the raw `phone` field; fall back to masked if the server
        // didn't include it (older client / different auth flow).
        const realPhone = profile.phone || (profile.phone_masked && profile.phone_masked.includes('*') ? null : profile.phone_masked);
        if (realPhone && /^1[3-9]\d{9}$/.test(realPhone)) {
          updates.customerPhone = realPhone;
        }
      }
      if (Object.keys(updates).length > 0) {
        this.setData(updates);
      }
    } catch (e) {
      // Not logged in or network error - fall back to local profile
    }
  },

  refreshCart() {
    const cart = app.globalData.cart;
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    // Resolve image URLs
    const cartWithImages = cart.map((item) => ({
      ...item,
      imageUrl: api.resolveImageUrl(item.image_url)
    }));
    this.setData({
      cart: cartWithImages,
      total: total.toFixed(2)
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
        // 移除
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
    // Only allow digits, max 11
    const value = (e.detail.value || '').replace(/\D/g, '').slice(0, 11);
    this.setData({ customerPhone: value });
  },

  // 提交订单
  async submit() {
    if (this.data.cart.length === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' });
      return;
    }

    // Validate customer info
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
        quantity: item.quantity
      }));

      // 1. 创建订单 (含顾客信息)
      const orderRes = await api.createOrder(items, {
        customer_note: this.data.note || undefined,
        customer_name: name,
        customer_phone: phone
      });
      const order = orderRes.data;

      // Save profile for next time
      wx.setStorageSync('customer_profile', { name, phone });

      // 2. 模拟支付（本地开发环境）
      const payResult = await api.mockPay(order.id);
      if (!payResult) {
        wx.hideLoading();
        this.setData({ submitting: false });
        return;
      }

      // 3. 清空购物车
      app.clearCart();

      wx.hideLoading();

      // 4. 跳转到成功页
      wx.redirectTo({
        url: `/pages/order-success/order-success?id=${order.id}`
      });
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
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  }
});
