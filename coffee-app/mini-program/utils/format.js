// filepath: coffee-app/mini-program/utils/format.js
// 工具函数

const STATUS_LABELS = {
  pending: '待支付',
  paid: '已支付',
  preparing: '制作中',
  ready: '可取餐',
  completed: '已完成',
  cancelled: '已取消',
  failed: '支付失败'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusClass(status) {
  return 'badge badge-' + status;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  STATUS_LABELS,
  statusLabel,
  statusClass,
  formatTime,
  formatDate
};
