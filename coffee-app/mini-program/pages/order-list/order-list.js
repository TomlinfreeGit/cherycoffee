// filepath: coffee-app/mini-program/pages/order-list/order-list.js
const api = require('../../utils/api.js');
const { formatTime, formatDate, statusLabel, statusClass } = require('../../utils/format.js');

Page({
  data: {
    orders: [],
    loading: true
  },

  onShow() {
    this.loadOrders();
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

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  }
});
