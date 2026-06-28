// filepath: coffee-app/mini-program/pages/order-success/order-success.js
const api = require('../../utils/api.js');
const { formatTime, statusLabel, statusClass } = require('../../utils/format.js');

Page({
  data: {
    order: null,
    statusClass: '',
    statusLabel: '',
    timeText: '',
    countdown: 0,
    timer: null
  },

  onLoad(options) {
    if (options.id) {
      this.loadOrder(options.id);
    }
  },

  onUnload() {
    if (this.data.timer) {
      clearInterval(this.data.timer);
    }
  },

  async loadOrder(id) {
    try {
      const res = await api.getOrder(id);
      const order = this.resolveOrderImages(res.data);
      this.setData({
        order,
        statusClass: statusClass(order.status),
        statusLabel: statusLabel(order.status)
      });
      this.startCountdown();
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // Resolve image URLs and add emoji fallback for each item
  resolveOrderImages(order) {
    if (!order || !order.items) return order;
    const items = order.items.map((item) => ({
      ...item,
      imageUrl: api.resolveImageUrl(item.product_image_url),
      emoji: '☕'
    }));
    return { ...order, items };
  },

  onImageError(e) {
    const id = e.currentTarget.dataset.id;
    const items = this.data.order.items.map((item) =>
      item.id === id ? { ...item, imageUrl: null } : item
    );
    this.setData({ 'order.items': items });
  },

  // 估算等待时间（每个商品 2 分钟，简单算法）
  startCountdown() {
    const order = this.data.order;
    if (!order) return;
    const totalItems = order.items.reduce((sum, it) => sum + it.quantity, 0);
    const minutes = Math.max(totalItems * 2, 5);
    this.setData({ countdown: minutes * 60 });

    const timer = setInterval(() => {
      const left = this.data.countdown - 1;
      if (left <= 0) {
        clearInterval(timer);
        this.setData({
          countdown: 0,
          timeText: '请到店'
        });
        this.refreshStatus();
        return;
      }
      const m = Math.floor(left / 60);
      const s = left % 60;
      this.setData({
        countdown: left,
        timeText: `约 ${m} 分钟`
      });
    }, 1000);

    this.setData({ timer });

    // 每 10 秒刷新一次订单状态
    this.statusTimer = setInterval(() => this.refreshStatus(), 10000);
  },

  async refreshStatus() {
    if (!this.data.order) return;
    try {
      const res = await api.getOrder(this.data.order.id);
      const order = res.data;
      this.setData({
        order,
        statusClass: statusClass(order.status),
        statusLabel: statusLabel(order.status)
      });
      // 如果已完成或已取餐，停止刷新
      if (['completed', 'cancelled', 'failed'].includes(order.status)) {
        clearInterval(this.statusTimer);
      }
    } catch (e) {
      // 静默失败
    }
  },

  goToDetail() {
    wx.redirectTo({
      url: `/pages/order-detail/order-detail?id=${this.data.order.id}`
    });
  },

  backToMenu() {
    wx.switchTab({ url: '/pages/menu/menu' });
  },

  goToList() {
    wx.switchTab({ url: '/pages/order-list/order-list' });
  }
});
