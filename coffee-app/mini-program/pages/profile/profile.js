// filepath: coffee-app/mini-program/pages/profile/profile.js
const api = require('../../utils/api.js');

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    phoneMasked: '',
    hasPhone: false,
    loading: true,
    saving: false
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const res = await api.getUserProfile();
      this.setData({
        nickname: res.data.nickname || '',
        avatarUrl: res.data.avatar_url || '',
        phoneMasked: res.data.phone_masked || '',
        hasPhone: !!res.data.has_phone,
        loading: false
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 微信 2.30.0+ 的 chooseAvatar 按钮回调
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    this.setData({ avatarUrl });
    // 立即上传到后端
    this.saveProfile({ avatar_url: avatarUrl });
  },

  // 昵称 input 的双向绑定
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  // 昵称 input blur 时保存
  onNicknameBlur() {
    const nickname = (this.data.nickname || '').trim();
    if (!nickname) return;
    this.saveProfile({ nickname });
  },

  async saveProfile(data) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.updateProfile(data);
      wx.showToast({ title: '已保存', icon: 'success', duration: 1000 });
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // 微信 getPhoneNumber 按钮回调
  onGetPhoneNumber(e) {
    // 用户拒绝授权时返回 errMsg 含 "fail"
    if (!e.detail.encryptedData || !e.detail.iv) {
      wx.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }
    this.bindPhone(e.detail.encryptedData, e.detail.iv);
  },

  async bindPhone(encryptedData, iv) {
    wx.showLoading({ title: '获取中...', mask: true });
    try {
      const res = await api.decryptPhone(encryptedData, iv);
      wx.hideLoading();
      wx.showToast({ title: '手机号已绑定', icon: 'success' });
      this.setData({
        hasPhone: true,
        phoneMasked: res.data.phone_masked
      });
    } catch (e) {
      wx.hideLoading();
      // 常见的错误：session_key 过期（需要重新登录）
      if (/session_key|session-key|re-login|重新登录/i.test(e.message)) {
        wx.showModal({
          title: '需要重新登录',
          content: '请先退出登录再重新进入小程序',
          showCancel: false
        });
      } else {
        wx.showModal({
          title: '获取失败',
          content: e.message,
          showCancel: false
        });
      }
    }
  },

  // 解绑手机号
  unbindPhone() {
    wx.showModal({
      title: '解绑手机号？',
      content: '解绑后下次下单需要重新授权',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.unbindPhone();
          wx.showToast({ title: '已解绑', icon: 'success' });
          this.setData({ hasPhone: false, phoneMasked: '' });
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败', icon: 'none' });
        }
      }
    });
  }
});
