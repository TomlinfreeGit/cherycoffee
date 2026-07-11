// filepath: coffee-app/mini-program/pages/order-list/order-list.js
const api = require('../../utils/api.js');
const { formatTime, formatDate, statusLabel, statusClass } = require('../../utils/format.js');

// 每页加载多少单。调小点便于测试和低端机，调大可减少请求次数。
const PAGE_SIZE = 20;

// 把原始订单对象转换为页面需要的展示字段 (抽取出来复用)
function decorate(o) {
  return {
    ...o,
    statusLabel: statusLabel(o.status),
    statusClass: statusClass(o.status),
    dateText: formatDate(o.created_at),
    timeText: formatTime(o.created_at)
  };
}

Page({
  data: {
    orders: [],
    loading: true,        // 首次加载(覆盖整页)状态
    loadingMore: false,   // 加载下一页状态
    hasMore: true,        // 是否还有下一页
    total: 0,             // 服务端返回的总单数
    profileSubtitle: '点击设置头像、昵称、手机号'
  },

  // 内部状态(不入 setData)
  _loadToken: 0,         // 递增的加载令牌,避免乱序响应覆盖数据
  _onScrollLowerDebounce: false, // 防 bindscrolltolower 短时间内多次触发

  onShow() {
    // 每次进入页面都重置到第一页 — 商家刚把订单标完成,用户想立刻看到。
    this.loadFirstPage();
    this.loadProfileSummary();
  },

  onPullDownRefresh() {
    this.loadFirstPage().finally(() => wx.stopPullDownRefresh());
  },

  // 加载第一页 (用于 onShow / 下拉刷新)
  async loadFirstPage() {
    if (this.data.loadingMore) return;
    const token = ++this._loadToken;
    this.setData({ loading: true });
    try {
      const res = await api.listOrders({ limit: PAGE_SIZE, offset: 0 });
      // 过期请求丢弃(用户切走后又回来时,旧响应不应该覆盖新数据)
      if (token !== this._loadToken) return;
      const orders = (res.data || []).map(decorate);
      this.setData({
        orders,
        total: res.total || orders.length,
        hasMore: !!res.hasMore,
        loading: false
      });
    } catch (e) {
      if (token !== this._loadToken) return;
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 滚到底 → 加载下一页
  async loadMore() {
    // 三个守卫:正在首次加载、正在加载更多、已经没更多了 → 都不做
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const token = ++this._loadToken;
    this.setData({ loadingMore: true });
    try {
      const res = await api.listOrders({
        limit: PAGE_SIZE,
        offset: this.data.orders.length
      });
      if (token !== this._loadToken) return;
      const more = (res.data || []).map(decorate);
      // 追加 (避免替换整个数组,保留滚动位置)
      this.setData({
        orders: this.data.orders.concat(more),
        total: res.total || this.data.orders.length,
        hasMore: !!res.hasMore,
        loadingMore: false
      });
    } catch (e) {
      if (token !== this._loadToken) return;
      wx.showToast({ title: e.message || '加载更多失败', icon: 'none' });
      this.setData({ loadingMore: false });
    }
  },

  // scroll-view 触底事件
  // bindscrolltolower 在低端机上会一次滚动触发多次,这里加一个 200ms
  // 的去抖窗口,保证最多 200ms 内只发一次请求。
  onScrollLower() {
    if (this._onScrollLowerDebounce) return;
    this._onScrollLowerDebounce = true;
    setTimeout(() => {
      this._onScrollLowerDebounce = false;
    }, 200);
    this.loadMore();
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
