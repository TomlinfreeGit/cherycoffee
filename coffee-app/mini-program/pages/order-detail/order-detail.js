// filepath: coffee-app/mini-program/pages/order-detail/order-detail.js
const api = require('../../utils/api.js');
const { formatDate, formatTime, statusLabel, statusClass } = require('../../utils/format.js');

Page({
  data: {
    order: null,
    statusClass: '',
    statusLabel: '',
    dateText: '',
    timeText: ''
  },

  onLoad(options) {
    if (options.id) {
      this.loadOrder(options.id);
    }
  },

  onShow() {
    if (this.data.order) {
      this.loadOrder(this.data.order.id);
    }
  },

  onPullDownRefresh() {
    if (this.data.order) {
      this.loadOrder(this.data.order.id).then(() => wx.stopPullDownRefresh());
    } else {
      wx.stopPullDownRefresh();
    }
  },

  async loadOrder(id) {
    try {
      const res = await api.getOrder(id);
      const order = this.resolveOrderImages(res.data);
      this.setData({
        order,
        statusClass: statusClass(order.status),
        statusLabel: statusLabel(order.status),
        dateText: formatDate(order.created_at),
        timeText: formatTime(order.created_at)
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  resolveOrderImages(order) {
    if (!order || !order.items) return order;
    const items = order.items.map((item) => ({
      ...item,
      imageUrl: api.resolveImageUrl(item.product_image_url)
    }));
    return { ...order, items };
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const items = this.data.order.items.map((item) =>
      item.id === id ? { ...item, imageUrl: null } : item
    );
    this.setData({ 'order.items': items });
  }
});
