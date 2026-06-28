// filepath: coffee-app/merchant-web/src/components/StatusBadge.tsx
import { Order } from '../api/client';

const LABELS: Record<Order['status'], string> = {
  pending: '待支付',
  paid: '已支付',
  preparing: '制作中',
  ready: '可取餐',
  completed: '已完成',
  cancelled: '已取消',
  failed: '支付失败'
};

export default function StatusBadge({ status }: { status: Order['status'] }) {
  return <span className={`status status-${status}`}>{LABELS[status]}</span>;
}
