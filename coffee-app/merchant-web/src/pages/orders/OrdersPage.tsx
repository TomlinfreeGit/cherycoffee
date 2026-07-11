// filepath: coffee-app/merchant-web/src/pages/orders/OrdersPage.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, Order, OrderItem } from '../../api/client';
import { showToast } from '../../components/Toast';
import { formatTime, formatPrice } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';
import { usePagedList } from '../../hooks/usePagedList';

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

const ORDER_PAGE_SIZE = 10;

export default function OrdersPage() {
  const [filter, setFilter] = useState<FilterStatus>('active');
  const [selected, setSelected] = useState<Order | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // 顶部 KPI 卡片:由独立接口 /orders/stats 提供,与分页 filter 独立
  const [stats, setStats] = useState({ active: 0, preparing: 0, ready: 0, today: 0 });

  // 500ms 去抖后,再触发后端查询 (避免每次按键都拉接口)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 500);
    return () => clearTimeout(t);
  }, [searchInput]);

  // filter 翻译:前端状态值 → 后端 status 参数
  //   'active' 后端翻译为 IN (...) ;'all' 不传 ;其他单值透传
  const apiStatus = filter === 'all' ? undefined : filter;

  // 分页列表:每页 10 条,滚到底自动加载下一页
  // filter 和 search 都进 deps,任何一项变化都会重置到第一页
  const list = usePagedList<Order>({
    pageSize: ORDER_PAGE_SIZE,
    deps: [search, filter],
    fetch: async (limit, offset) => {
      const res = await api.listOrders({
        status: apiStatus,
        search: search || undefined,
        limit,
        offset
      });
      if (Array.isArray((res as any).data) && typeof (res as any).hasMore === 'boolean') {
        return res as any;
      }
      const data = (res as any).data || [];
      return { data, total: data.length, hasMore: false };
    }
  });
  const orders = list.items;

  // 顶部 KPI 卡片独立拉取 (不受 filter/search/分页影响)
  const refreshStats = useCallback(async () => {
    try {
      const res = await api.getOrderStats();
      setStats(res.data);
    } catch {
      // 静默忽略 KPI 加载错误,不影响列表
    }
  }, []);
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // 自动刷新:每 5s 同时刷新列表第一页 + 统计(因为状态会变)
  // 已加载第二页之后的页面不刷新,避免跳到顶部让用户丢失阅读位置
  const loadRef = useRef(list.refresh);
  loadRef.current = list.refresh;
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      loadRef.current();
      refreshStats();
    }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshStats]);

  // 后端已经按 status 过滤过了,这里直接用 items 渲染
  const filtered = orders;

  const handleStatusUpdate = async (order: Order, newStatus: Order['status']) => {
    try {
      await api.updateOrderStatus(order.id, newStatus);
      showToast(`订单 ${order.pickup_number} 已更新`, 'success');
      list.refresh();
      refreshStats();
      if (selected && selected.id === order.id) {
        const updated = await api.getOrder(order.id);
        setSelected(updated.data);
      }
    } catch (e: any) {
      showToast(`更新失败：${e.message}`, 'error');
    }
  };

  // Open order detail modal: fetch the full order (with items) first.
  // The list endpoint doesn't include items to keep responses small.
  const openOrderDetail = async (orderId: number) => {
    try {
      const res = await api.getOrder(orderId);
      setSelected(res.data);
    } catch (e: any) {
      showToast(`加载详情失败：${e.message}`, 'error');
    }
  };

  // 顶部 KPI 数字来自 /api/merchant/orders/stats,不是本地计算
  const counts = stats;

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
            <button className="btn btn-sm" onClick={list.refresh}>
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
            placeholder="搜索：手机号 / 姓名"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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

        {list.loading ? (
          <div className="empty">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty">暂无订单</div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              {filter !== 'all' && (
                <span>当前过滤: “{FILTER_OPTIONS.find((o) => o.value === filter)?.label}” · </span>
              )}
              共 {list.total} 单，当前显示 {filtered.length} 单
            </div>
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
                    <button className="btn btn-sm" onClick={() => openOrderDetail(o.id)}>
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

          {/* 列表底部:sentinel + 手动加载更多按钮 (有些浏览器 IntersectionObserver 不可用) */}
          <div
            ref={list.sentinelRef}
            style={{ height: 1, marginTop: 16 }}
            aria-hidden="true"
          />
          <div style={{ textAlign: 'center', padding: '16rpx 0 24rpx', color: 'var(--muted)', fontSize: 13 }}>
            {list.loadingMore && <span>加载中…</span>}
            {!list.loadingMore && list.hasMore && (
              <button className="btn btn-sm" onClick={list.loadMore}>
                加载更多
              </button>
            )}
            {!list.loadingMore && !list.hasMore && list.total > 0 && (
              <span>— 已显示全部 {list.total} 单 —</span>
            )}
          </div>
          </>
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
