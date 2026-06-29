// filepath: coffee-app/mini-program/pages/profile/profile.js
const api = require('../../utils/api.js');

const PHONE_REGEX = /^1[3-9]\d{9}$/;

Page({
  data: {
    nickname: '',
    phoneMasked: '',
    hasPhone: false,
    loading: true,
    saving: false,
    // Manual phone entry fallback
    manualOpen: false,
    manualPhone: ''
  },

  // Internal state (not in data)
  _nicknameTimer: null,
  _popupHintTimer: null,
  _phoneCallbackFired: false,

  onShow() {
    this.loadProfile();
  },

  onUnload() {
    if (this._nicknameTimer) {
      clearTimeout(this._nicknameTimer);
      this._nicknameTimer = null;
      this.flushNickname();
    }
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const res = await api.getUserProfile();
      this.setData({
        nickname: res.data.nickname || '',
        phoneMasked: res.data.phone_masked || '',
        hasPhone: !!res.data.has_phone,
        loading: false
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 昵称 input - 每次输入更新本地状态，600ms 后自动保存
  onNicknameInput(e) {
    const value = e.detail.value;
    this.setData({ nickname: value });

    if (this._nicknameTimer) clearTimeout(this._nicknameTimer);
    this._nicknameTimer = setTimeout(() => {
      this._nicknameTimer = null;
      const trimmed = (this.data.nickname || '').trim();
      if (trimmed && trimmed.length <= 30) {
        this.saveProfile({ nickname: trimmed }, true);
      }
    }, 600);
  },

  // blur 或回车：立即保存
  onNicknameBlur() {
    if (this._nicknameTimer) {
      clearTimeout(this._nicknameTimer);
      this._nicknameTimer = null;
    }
    this.flushNickname();
  },

  flushNickname() {
    const nickname = (this.data.nickname || '').trim();
    if (!nickname) return;
    this.saveProfile({ nickname }, false);
  },

  async saveProfile(data, silent) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.updateProfile(data);
      if (!silent) {
        wx.showToast({ title: '已保存', icon: 'success', duration: 1000 });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ─── 手机号授权 ────────────────────────────────────
  // 普通 tap 回调：用于在微信不弹授权框时（例如开发工具模拟器），
  // 800ms 后如果 getPhoneNumber 没触发，自动展开手动输入。
  onPhoneBtnTap() {
    if (this._popupHintTimer) clearTimeout(this._popupHintTimer);
    this._phoneCallbackFired = false;
    this._popupHintTimer = setTimeout(() => {
      this._popupHintTimer = null;
      if (!this.data.hasPhone && !this._phoneCallbackFired) {
        this.setData({ manualOpen: true });
        wx.showToast({
          title: '请使用手动输入',
          icon: 'none',
          duration: 2000
        });
      }
    }, 800);
  },

  // 微信 getPhoneNumber 回调
  onGetPhoneNumber(e) {
    this._phoneCallbackFired = true;
    if (this._popupHintTimer) {
      clearTimeout(this._popupHintTimer);
      this._popupHintTimer = null;
    }

    const detail = e.detail || {};
    const isCancel =
      !detail.encryptedData ||
      !detail.iv ||
      /fail|deny|cancel/i.test(detail.errMsg || '');

    if (isCancel) {
      // 检测是否在开发工具模拟器
      let isSimulator = false;
      try {
        isSimulator = wx.getSystemInfoSync().platform === 'devtools';
      } catch (_) {}
      if (isSimulator) {
        this.setData({ manualOpen: true });
      }
      return;
    }

    this.bindPhone(detail.encryptedData, detail.iv);
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
      if (/session_key|session-key|re-login|重新登录/i.test(e.message)) {
        wx.showModal({
          title: '需要重新登录',
          content: '请先退出登录再重新进入小程序后再试；或使用手动输入',
          confirmText: '手动输入',
          cancelText: '取消',
          success: (r) => {
            if (r.confirm) this.setData({ manualOpen: true });
          }
        });
      } else if (/No session_key|USE_REAL_WECHAT_AUTH/i.test(e.message)) {
        this.setData({ manualOpen: true });
        wx.showToast({ title: '请使用手动输入', icon: 'none', duration: 2000 });
      } else {
        wx.showModal({
          title: '获取失败',
          content: e.message,
          showCancel: false
        });
      }
    }
  },

  // ─── 手动输入手机号 ───────────────────────────
  toggleManual() {
    this.setData({ manualOpen: !this.data.manualOpen });
  },

  onManualPhoneInput(e) {
    const value = (e.detail.value || '').replace(/\D/g, '').slice(0, 11);
    this.setData({ manualPhone: value });
  },

  async onManualSave() {
    const phone = (this.data.manualPhone || '').trim();
    if (!PHONE_REGEX.test(phone)) {
      wx.showToast({ title: '请输入有效的 11 位手机号', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const res = await api.setPhonePlain(phone);
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({
        hasPhone: true,
        phoneMasked: res.data.phone_masked,
        manualOpen: false,
        manualPhone: ''
      });
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ─── 解绑 ──────────────────────────────────────
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
