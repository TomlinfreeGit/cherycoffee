// filepath: coffee-app/merchant-web/src/pages/users/UsersPage.tsx
import { useEffect, useState } from 'react';
import { api, User } from '../../api/client';
import { showToast } from '../../components/Toast';
import { formatTime, formatDate } from '../../utils/format';
import { usePagedList } from '../../hooks/usePagedList';

type PhoneFilter = 'all' | 'yes' | 'no';

const USER_PAGE_SIZE = 100;

export default function UsersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>('all');
  const [deletingOpenid, setDeletingOpenid] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);

  // 400ms 去抖后送到后端
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 分页列表
  const list = usePagedList<User>({
    pageSize: USER_PAGE_SIZE,
    deps: [search, phoneFilter],
    fetch: async (limit, offset) => {
      const params: { search?: string; has_phone?: boolean; limit: number; offset: number } = {
        limit,
        offset
      };
      if (search) params.search = search;
      if (phoneFilter === 'yes') params.has_phone = true;
      if (phoneFilter === 'no') params.has_phone = false;
      const res = await api.listUsers(params);
      return res;
    }
  });
  const users = list.items;
  const total = list.total;
  const loading = list.loading;

  const handleDeleteClick = (u: User) => {
    setConfirmTarget(u);
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget) return;
    const openid = confirmTarget.openid;
    setDeletingOpenid(openid);
    try {
      const res = await api.deleteUser(openid);
      const { anonymized_orders, deleted_sessions } = res.data;
      showToast(
        `已删除用户${anonymized_orders ? `，匿名化 ${anonymized_orders} 个订单` : ''}${deleted_sessions ? `，强制登出 ${deleted_sessions} 个会话` : ''}`,
        'success'
      );
      setConfirmTarget(null);
      list.refresh();
    } catch (e: any) {
      showToast(`删除失败：${e.message}`, 'error');
    } finally {
      setDeletingOpenid(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">用户管理</h2>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          共 {total} 个用户
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="search-input"
          type="text"
          placeholder="搜索昵称 / 手机号"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className="chip-group">
          <button
            className={`chip ${phoneFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPhoneFilter('all')}
          >全部</button>
          <button
            className={`chip ${phoneFilter === 'yes' ? 'active' : ''}`}
            onClick={() => setPhoneFilter('yes')}
          >已绑手机</button>
          <button
            className={`chip ${phoneFilter === 'no' ? 'active' : ''}`}
            onClick={() => setPhoneFilter('no')}
          >未绑手机</button>
        </div>
      </div>

      {loading ? (
        <div className="empty">加载中...</div>
      ) : users.length === 0 ? (
        <div className="empty">暂无符合条件的用户</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 100 }}>昵称</th>
              <th style={{ width: 140 }}>手机号</th>
              <th style={{ width: 100 }}>等级</th>
              <th style={{ width: 80 }}>订单数</th>
              <th style={{ width: 140 }}>最近下单</th>
              <th style={{ width: 160 }}>注册时间</th>
              <th style={{ width: 140 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.openid}>
                <td>
                  {u.nickname || <span style={{ color: 'var(--muted)' }}>未设置</span>}
                </td>
                <td>
                  {u.has_phone ? (
                    <span title="手机号已脱敏显示">{u.phone}</span>
                  ) : (
                    <span className="status status-cancelled">未绑定</span>
                  )}
                </td>
                <td>
                  <span className={`level-pill ${(u.level || 1) <= 1 ? 'muted' : ''}`}>
                    Lv.{u.level || 1}
                  </span>
                  {(u.completed_orders || 0) > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                      已完成 {u.completed_orders}
                    </span>
                  )}
                </td>
                <td>
                  {u.order_count > 0 ? (
                    <strong>{u.order_count}</strong>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>0</span>
                  )}
                </td>
                <td>
                  {u.last_order_at ? (
                    <span style={{ fontSize: 12 }}>{formatDate(u.last_order_at)}</span>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>—</span>
                  )}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {formatDate(u.created_at)}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteClick(u)}
                      disabled={deletingOpenid === u.openid}
                    >
                      {deletingOpenid === u.openid ? '删除中...' : '删除'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 分页底部:sentinel + 手动加载更多按钮 */}
      {!loading && users.length > 0 && (
        <>
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
            {!list.loadingMore && !list.hasMore && total > 0 && (
              <span>— 已显示全部 {total} 个用户 —</span>
            )}
          </div>
        </>
      )}

      {confirmTarget && (
        <div className="modal-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">删除用户？</h3>
            <div className="modal-body">
              <p>确定要删除用户 <strong>{confirmTarget.nickname || confirmTarget.openid.slice(0, 16) + '...'}</strong> 吗？</p>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
                此操作将：
              </p>
              <ul style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4, paddingLeft: 20 }}>
                <li>永久删除该用户的档案（昵称、头像、手机号）</li>
                <li>强制该用户的所有设备登出（删除所有 session）</li>
                <li>匿名化其历史订单（清空 customer_name / customer_phone / openid）</li>
              </ul>
              <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>
                ⚠ 操作不可撤销
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmTarget(null)} disabled={deletingOpenid !== null}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmDelete}
                disabled={deletingOpenid !== null}
              >
                {deletingOpenid ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
