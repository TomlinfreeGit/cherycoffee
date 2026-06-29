// filepath: coffee-app/mini-program/pages/order-list/order-list.js
const api = require('../../utils/api.js');
const { formatTime, formatDate, statusLabel, statusClass } = require('../../utils/format.js');

Page({
  data: {
    orders: [],
    loading: true,
    profileSubtitle: '点击设置头像、昵称、手机号'
  },

  onShow() {
    this.loadOrders();
    this.loadProfileSummary();
  },

  onPullDownRefresh() {
    this.loadOrders().then(() => wx.stopPullDownRefresh());
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      const res = await api.listOrders();
      const orders = res.data.map((o) => ({
        ...o,
        statusLabel: statusLabel(o.status),
        statusClass: statusClass(o.status),
        dateText: formatDate(o.created_at),
        timeText: formatTime(o.created_at)
      }));
      this.setData({ orders });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // Show a short profile summary in the card subtitle
  async loadProfileSummary() {
    try {
      const res = await api.getUserProfile();
      const parts = [];
      if (res.data.nickname) parts.push(res.data.nickname);
      if (res.data.phone_masked) parts.push(res.data.phone_masked);
      this.setData({
        profileSubtitle: parts.length ? parts.join(' · ') : '点击设置头像、昵称、手机号'
      });
    } catch (e) {
      // ignore - the card still works as a navigation entry
    }
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  }
});
