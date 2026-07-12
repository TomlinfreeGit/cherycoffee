// filepath: coffee-app/mini-program/pages/order-detail/order-detail.js
const api = require('../../utils/api.js');
const { formatDate, formatTime, statusLabel, statusClass } = require('../../utils/format.js');

Page({
  data: {
    order: null,
    statusClass: '',
    statusLabel: '',
    dateText: '',
    timeText: '',
    paying: false                  // 防重复点"立即支付"
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
  },

  // 立即支付 / 继续支付:仅对 pending 状态订单有意义
  async onPay() {
    const order = this.data.order;
    if (!order || order.status !== 'pending') return;
    if (this.data.paying) return;

    this.setData({ paying: true });
    wx.showLoading({ title: '拉起支付...', mask: true });
    try {
      const params = await api.requestWxPayment(await api.preparePayParams(order.id));
      // 回调中更新订单状态 (真实支付);mock 模式弹窗模拟成功时直接更新
      wx.hideLoading();
      wx.showToast({ title: '支付成功', icon: 'success' });
      // 拉一次最新状态
      this.loadOrder(order.id);
    } catch (err) {
      wx.hideLoading();
      if (err.code === 'CANCEL') {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        wx.showModal({ title: '支付失败', content: err.message || '请稍后再试', showCancel: false });
      }
    } finally {
      this.setData({ paying: false });
    }
  },

  // 取消订单 (仅 pending 状态可操作)
  onCancel() {
    const order = this.data.order;
    if (!order || order.status !== 'pending') return;
    wx.showModal({
      title: '取消订单',
      content: `确认取消 ${order.pickup_number} 号订单?取消后无法恢复`,
      success: async (modalRes) => {
        if (!modalRes.confirm) return;
        wx.showLoading({ title: '取消中...', mask: true });
        try {
          await api.updateOrderStatus(order.id, 'cancelled');
          wx.hideLoading();
          wx.showToast({ title: '已取消', icon: 'success' });
          this.loadOrder(order.id);
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message || '取消失败', icon: 'none' });
        }
      }
    });
  }
});
