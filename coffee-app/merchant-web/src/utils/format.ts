// filepath: coffee-app/merchant-web/src/utils/format.ts
export function formatTime(iso: string): string {
  const d = new Date(iso);
  // Convert to local time string in HH:MM:SS
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN') + ' ' + formatTime(iso);
}

export function formatPrice(p: number): string {
  return `¥${p.toFixed(2)}`;
}
