// filepath: coffee-app/merchant-web/src/hooks/usePagedList.ts
// 通用分页数据 hook:商品/订单/用户列表都可以复用。
//
// 设计要点:
//   - 使用 "加载更多" 按钮 + 滚动到底自动触发 (IntersectionObserver sentinel)
//   - 内部维护 _loadToken,防止过期的响应覆盖新数据
//   - 切换过滤器 / 搜索词时自动重置为第一页
//   - 错误状态独立保留,不会清除已加载的数据 (避免点 "加载更多" 报错后整个列表消失)
//
// 使用示例:
//   const list = usePagedList({
//     fetch: (limit, offset) => api.listUsers({ search, limit, offset }),
//     deps: [search, phoneFilter]
//   });
//   list.items / list.loading / list.hasMore / list.total / list.loadMore() / list.refresh()

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PagedListOptions<T> {
  // 实际拉一页数据的函数 (limit + offset)
  fetch: (limit: number, offset: number) => Promise<{
    data: T[];
    total?: number;
    hasMore?: boolean;
  }>;
  // 每页大小
  pageSize?: number;
  // 重新加载的依赖 (例如 search / filter 变化)
  deps: ReadonlyArray<unknown>;
}

export interface PagedList<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  total: number;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
  // 给底部 sentinel 元素绑定的 ref,触发自动加载
  sentinelRef: (el: HTMLElement | null) => void;
}

export function usePagedList<T>(opts: PagedListOptions<T>): PagedList<T> {
  const { fetch: doFetch, pageSize = 50, deps } = opts;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用 ref 跟踪最新值,避免 useCallback 把 loadingMore 放进依赖导致重复绑定
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // 递增令牌:旧请求回来时丢弃 (用户切换过滤器瞬间的过期响应)
  const tokenRef = useRef(0);
  // 缓存最新 doFetch,避免 deps 改变后闭包过期
  const doFetchRef = useRef(doFetch);
  doFetchRef.current = doFetch;

  const loadFirst = useCallback(async () => {
    const myToken = ++tokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await doFetchRef.current(pageSize, 0);
      if (myToken !== tokenRef.current) return;
      setItems(res.data || []);
      setTotal(res.total ?? (res.data || []).length);
      setHasMore(!!res.hasMore);
      setLoading(false);
    } catch (e: any) {
      if (myToken !== tokenRef.current) return;
      setError(e.message || '加载失败');
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    // 三个守卫:首次加载中 / 已在加载更多 / 已经到底
    if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) return;
    const myToken = ++tokenRef.current;
    setLoadingMore(true);
    try {
      const res = await doFetchRef.current(pageSize, items.length);
      if (myToken !== tokenRef.current) return;
      setItems((prev) => prev.concat(res.data || []));
      setHasMore(!!res.hasMore);
      setTotal(res.total ?? items.length + (res.data || []).length);
      setLoadingMore(false);
    } catch (e: any) {
      if (myToken !== tokenRef.current) return;
      setError(e.message || '加载更多失败');
      setLoadingMore(false);
    }
  }, [items.length, pageSize]);

  // deps 改变 → 重新加载第一页
  useEffect(() => {
    loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // IntersectionObserver: 底部 sentinel 进入视口 → loadMore()
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (el: HTMLElement | null) => {
      // 解绑旧的
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) loadMore();
          }
        },
        { rootMargin: '200px 0px' } // 提前 200px 触发,体感更顺
      );
      io.observe(el);
      observerRef.current = io;
    },
    [loadMore]
  );

  // 卸载时清理
  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  const refresh = useCallback(() => {
    loadFirst();
  }, [loadFirst]);

  return { items, loading, loadingMore, total, hasMore, error, loadMore, refresh, sentinelRef };
}