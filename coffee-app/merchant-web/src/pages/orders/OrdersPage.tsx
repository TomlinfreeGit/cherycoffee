// filepath: coffee-app/merchant-web/src/pages/orders/OrdersPage.tsx
import { useEffect, useState, useCallback } from 'react';
import { api, Order, OrderItem } from '../../api/client';
import { showToast } from '../../components/Toast';
import { formatTime, formatPrice } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';

type FilterStatus = 'all' | 'active' | Order['status'];

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'active', label: '进行中' },
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'preparing', label: '制作中' },
  { value: 'ready', label: '可取餐' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' }
];

const NEXT_STATUS: Partial<Record<Order['status'], { status: Order['status']; label: string; primary?: boolean }[]>> = {
  pending: [{ status: 'paid', label: '标记已支付', primary: true }],
  paid: [
    { status: 'preparing', label: '开始制作', primary: true },
    { status: 'cancelled', label: '取消' }
  ],
  preparing: [{ status: 'ready', label: '完成制作', primary: true }],
  ready: [{ status: 'completed', label: '已取餐', primary: true }]
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('active');
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.listOrders(search ? { search } : undefined);
      setOrders(res.data);
    } catch (e: any) {
      showToast(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  const filtered = (() => {
    if (filter === 'all') return orders;
    if (filter === 'active')
      return orders.filter((o) =>
        ['pending', 'paid', 'preparing', 'ready'].includes(o.status)
      );
    return orders.filter((o) => o.status === filter);
  })();

  const handleStatusUpdate = async (order: Order, newStatus: Order['status']) => {
    try {
      await api.updateOrderStatus(order.id, newStatus);
      showToast(`订单 ${order.pickup_number} 已更新`, 'success');
      load();
      if (selected && selected.id === order.id) {
        const updated = await api.getOrder(order.id);
        setSelected(updated.data);
      }
    } catch (e: any) {
      showToast(`更新失败：${e.message}`, 'error');
    }
  };

  const counts = {
    active: orders.filter((o) => ['pending', 'paid', 'preparing', 'ready'].includes(o.status)).length,
    ready: orders.filter((o) => o.status === 'ready').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    today: orders.filter((o) => {
      const d = new Date(o.created_at);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>进行中</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{counts.active}</div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>制作中</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--info)' }}>{counts.preparing}</div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>待取餐</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--warning)' }}>{counts.ready}</div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>今日订单</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{counts.today}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">订单列表</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                style={{ width: 'auto' }}
              />
              自动刷新 (5s)
            </label>
            <button className="btn btn-sm" onClick={load}>
              ↻ 刷新
            </button>
          </div>
        </div>

        <div className="filter-bar">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`chip ${filter === opt.value ? 'active' : ''}`}
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="搜索：手机号 / 姓名（回车）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            style={{
              flex: 1,
              minWidth: 200,
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 999,
              fontSize: 13
            }}
          />
        </div>

        {loading ? (
          <div className="empty">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty">暂无订单</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>取餐号</th>
                <th>状态</th>
                <th>取餐人</th>
                <th>电话</th>
                <th>商品</th>
                <th>金额</th>
                <th>下单时间</th>
                <th style={{ width: 240 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="pickup-number">{o.pickup_number}</span>
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    <strong>{o.customer_name || '—'}</strong>
                  </td>
                  <td>
                    {o.customer_phone_masked || '—'}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setSelected(o)}>
                      查看详情
                    </button>
                  </td>
                  <td>{formatPrice(o.total_amount)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{formatTime(o.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {(NEXT_STATUS[o.status] || []).map((act) => (
                        <button
                          key={act.status}
                          className={`btn btn-sm ${act.primary ? 'btn-primary' : ''}`}
                          onClick={() => handleStatusUpdate(o, act.status)}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && <OrderDetailModal order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [detail, setDetail] = useState<Order>(order);
  const [fullPhone, setFullPhone] = useState<string | null>(null);
  const [phoneRevealed, setPhoneRevealed] = useState(false);

  useEffect(() => {
    setDetail(order);
    setFullPhone(null);
    setPhoneRevealed(false);
  }, [order]);

  const revealPhone = async () => {
    if (phoneRevealed) return;
    try {
      const phone = await api.revealFullPhone(order.id);
      setFullPhone(phone);
      setPhoneRevealed(true);
      showToast('已显示完整手机号（操作已记录）', 'success');
    } catch (e: any) {
      showToast(`获取失败：${e.message}`, 'error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>取餐号</div>
            <div className="pickup-number" style={{ fontSize: 28, marginTop: 4 }}>
              {detail.pickup_number}
            </div>
          </div>
          <StatusBadge status={detail.status} />
        </div>

        {(detail.customer_name || detail.customer_phone_masked) && (
          <div style={{
            marginTop: 16,
            padding: 12,
            background: 'var(--bg)',
            borderRadius: 6,
            fontSize: 14
          }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>取餐人信息</div>
            {detail.customer_name && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--muted)' }}>姓名：</span>
                <strong>{detail.customer_name}</strong>
              </div>
            )}
            {detail.customer_phone_masked && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ color: 'var(--muted)' }}>电话：</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {phoneRevealed && fullPhone ? fullPhone : detail.customer_phone_masked}
                  </span>
                </div>
                {!phoneRevealed && (
                  <button
                    className="btn btn-sm"
                    onClick={revealPhone}
                    title="显示完整手机号（操作会被记录）"
                  >
                    查看完整
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>商品列表</div>
          <table>
            <tbody>
              {(detail.items || []).map((item: OrderItem) => (
                <tr key={item.id}>
                  <td>
                    {item.product_name}
                    <span style={{ color: 'var(--muted)', marginLeft: 8 }}>x{item.quantity}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatPrice(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>合计</th>
                <th style={{ textAlign: 'right' }}>{formatPrice(detail.total_amount)}</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {detail.customer_note && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>顾客备注</div>
            <div>{detail.customer_note}</div>
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          下单时间：{detail.created_at}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
