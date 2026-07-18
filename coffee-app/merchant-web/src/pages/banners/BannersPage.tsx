// filepath: coffee-app/merchant-web/src/pages/banners/BannersPage.tsx
// 菜单顶部大图轮播 (Banner / Carousel) 管理页面。
// 商家可在此:
//   - 上传图片作为轮播素材
//   - 调整标题、点击跳转 (分类 / 商品 / 不跳转)
//   - 启用 / 禁用
//   - 上下移动调整顺序
//   - 删除
//
// 已启用的 banner 会出现在小程序菜单页顶部的 swiper 轮播里 (按 sort_order 升序)。

import { useEffect, useRef, useState } from 'react';
import { api, Banner, Category } from '../../api/client';
import { handleUnauthorized } from '../../api/client';
import { API_BASE, resolveImageUrl } from '../../api/config';
import { auth } from '../../api/auth';
import { showToast } from '../../components/Toast';

const MAX_BANNERS = 10; // 与后端限制保持一致

type BannerFormData = {
  image_url: string;
  title: string;
  link_type: Banner['link_type'];
  link_value: string;
  enabled: boolean;
};

const emptyForm: BannerFormData = {
  image_url: '',
  title: '',
  link_type: 'none',
  link_value: '',
  enabled: true
};

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listBanners();
      setBanners(res.data);
    } catch (e: any) {
      showToast(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    // 跳转目标下拉需要的选项 (分类、商品)
    try {
      const [catRes, prodRes] = await Promise.all([
        api.listCategories(),
        api.listProducts()
      ]);
      setCategories(catRes.data);
      setProducts(prodRes.data.map((p) => ({ id: p.id, name: p.name })));
    } catch (e: any) {
      console.warn('Failed to load lookups:', e.message);
    }
  };

  useEffect(() => {
    load();
    loadLookups();
  }, []);

  // ─── Reorder ─────────────────────────────────────────────────────
  const handleMove = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= banners.length) return;
    const next = banners.slice();
    const [item] = next.splice(idx, 1);
    next.splice(newIdx, 0, item);
    setBanners(next); // 乐观更新
    try {
      await api.reorderBanners(next.map((b) => b.id));
    } catch (e: any) {
      showToast(`排序失败：${e.message}`, 'error');
      load();
    }
  };

  // ─── Toggle enabled ──────────────────────────────────────────────
  const handleToggle = async (b: Banner) => {
    try {
      await api.updateBanner(b.id, { enabled: b.enabled ? 0 : 1 });
      showToast(b.enabled ? '已下架' : '已上架', 'success');
      load();
    } catch (e: any) {
      showToast(`操作失败：${e.message}`, 'error');
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────
  const handleDelete = async (b: Banner) => {
    if (!window.confirm(`确定删除这张轮播图？`)) return;
    setSavingId(b.id);
    try {
      await api.deleteBanner(b.id);
      showToast('已删除', 'success');
      load();
    } catch (e: any) {
      showToast(`删除失败：${e.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  };

  // ─── Save (create or update) ────────────────────────────────────
  const handleSave = async (id: number | null, form: BannerFormData) => {
    setSavingId(id ?? -1);
    try {
      const payload: any = {
        image_url: form.image_url,
        title: form.title.trim() || null,
        link_type: form.link_type,
        link_value: form.link_type === 'none' ? null : form.link_value,
        enabled: form.enabled ? 1 : 0
      };
      if (id == null) {
        await api.createBanner(payload);
        showToast('已添加', 'success');
      } else {
        await api.updateBanner(id, payload);
        showToast('已保存', 'success');
      }
      setCreating(false);
      setEditingId(null);
      load();
    } catch (e: any) {
      showToast(`保存失败：${e.message}`, 'error');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">菜单轮播图</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            顾客在小程序「菜单」页面顶部看到的大图轮播。建议尺寸 16:9 或 4:3，
            推荐上传横版 JPG/PNG/WebP，单张不超过 5MB。最多 {MAX_BANNERS} 张。
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled={banners.length >= MAX_BANNERS}
          onClick={() => setCreating(true)}
          title={banners.length >= MAX_BANNERS ? `已达上限 ${MAX_BANNERS} 张` : ''}
        >
          + 添加轮播图
        </button>
      </div>

      {loading ? (
        <div className="empty">加载中...</div>
      ) : banners.length === 0 ? (
        <div className="empty">
          还没有轮播图，点上方「+ 添加轮播图」开始
        </div>
      ) : (
        <div className="banner-list">
          {banners.map((b, idx) => (
            <BannerRow
              key={b.id}
              banner={b}
              index={idx}
              total={banners.length}
              busy={savingId === b.id}
              onMoveUp={() => handleMove(idx, -1)}
              onMoveDown={() => handleMove(idx, 1)}
              onToggle={() => handleToggle(b)}
              onEdit={() => setEditingId(b.id)}
              onDelete={() => handleDelete(b)}
            />
          ))}
        </div>
      )}

      {creating && (
        <BannerEditor
          title="添加轮播图"
          initial={emptyForm}
          categories={categories}
          products={products}
          saving={savingId === -1}
          onCancel={() => setCreating(false)}
          onSave={(form) => handleSave(null, form)}
        />
      )}

      {editingId != null && (() => {
        const b = banners.find((x) => x.id === editingId);
        if (!b) return null;
        return (
          <BannerEditor
            title={`编辑轮播图 #${b.id}`}
            initial={{
              image_url: b.image_url,
              title: b.title || '',
              link_type: b.link_type,
              link_value: b.link_value || '',
              enabled: !!b.enabled
            }}
            categories={categories}
            products={products}
            saving={savingId === editingId}
            onCancel={() => setEditingId(null)}
            onSave={(form) => handleSave(editingId, form)}
          />
        );
      })()}
    </div>
  );
}

// ─── 单行 ─────────────────────────────────────────────────────────────
function BannerRow({
  banner,
  index,
  total,
  busy,
  onMoveUp,
  onMoveDown,
  onToggle,
  onEdit,
  onDelete
}: {
  banner: Banner;
  index: number;
  total: number;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const url = resolveImageUrl(banner.image_url);
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div className={`banner-row ${banner.enabled ? '' : 'banner-disabled'}`}>
      <div className="banner-thumb">
        {url ? (
          <img src={url} alt={banner.title || `轮播图 ${index + 1}`} />
        ) : (
          <div className="banner-thumb-placeholder">无图</div>
        )}
      </div>
      <div className="banner-info">
        <div className="banner-title-line">
          <strong>#{index + 1}</strong>
          <span className="banner-title-text">
            {banner.title || <span style={{ color: 'var(--muted)' }}>无标题</span>}
          </span>
          {banner.enabled ? (
            <span className="status status-completed">展示中</span>
          ) : (
            <span className="status status-cancelled">已下架</span>
          )}
        </div>
        <div className="banner-meta">
          跳转:
          {banner.link_type === 'none' && ' 不跳转'}
          {banner.link_type === 'category' && ` 分类「${banner.link_value}」`}
          {banner.link_type === 'product' && ` 商品 #${banner.link_value}`}
        </div>
        <div className="banner-url">{banner.image_url}</div>
      </div>
      <div className="banner-actions">
        <div className="reorder-group">
          <button
            className="btn btn-sm"
            disabled={isFirst || busy}
            onClick={onMoveUp}
            title="上移"
          >
            ↑
          </button>
          <button
            className="btn btn-sm"
            disabled={isLast || busy}
            onClick={onMoveDown}
            title="下移"
          >
            ↓
          </button>
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={onToggle}>
          {banner.enabled ? '下架' : '上架'}
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={onEdit}>
          编辑
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={onDelete}
        >
          删除
        </button>
      </div>
    </div>
  );
}

// ─── 编辑弹窗 ───────────────────────────────────────────────────────────
function BannerEditor({
  title,
  initial,
  categories,
  products,
  saving,
  onCancel,
  onSave
}: {
  title: string;
  initial: BannerFormData;
  categories: Category[];
  products: { id: number; name: string }[];
  saving: boolean;
  onCancel: () => void;
  onSave: (form: BannerFormData) => void;
}) {
  const [form, setForm] = useState<BannerFormData>(initial);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = resolveImageUrl(form.image_url);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片太大（最大 5MB）', 'error');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = auth.getToken();
      if (!token) throw new Error('未登录,请重新登录后重试');
      const res = await fetch(`${API_BASE}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (res.status === 401) {
        await handleUnauthorized();
        throw new Error('登录已过期,请重新登录');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '上传失败' }));
        throw new Error(err.error || `上传失败 ${res.status}`);
      }
      const result = await res.json();
      setForm((f) => ({ ...f, image_url: result.data.url }));
      showToast('图片上传成功', 'success');
    } catch (err: any) {
      showToast(`上传失败：${err.message}`, 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = () => {
    if (!form.image_url) {
      showToast('请上传一张图片', 'error');
      return;
    }
    if (form.link_type !== 'none' && !form.link_value) {
      showToast('请选择跳转目标', 'error');
      return;
    }
    onSave(form);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h3 className="panel-title" style={{ marginBottom: 20 }}>
          {title}
        </h3>

        <div className="form-group">
          <label>图片</label>
          <div className="image-upload-area">
            {previewUrl ? (
              <div className="image-preview">
                <img src={previewUrl} alt="预览" />
                <div className="image-preview-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? '上传中...' : '更换'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => setForm((f) => ({ ...f, image_url: '' }))}
                    disabled={uploading}
                  >
                    移除
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="image-upload-placeholder"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <div className="upload-spinner">⏳</div>
                    <div>上传中...</div>
                  </>
                ) : (
                  <>
                    <div className="upload-icon">🖼️</div>
                    <div>点击上传图片</div>
                    <div className="upload-hint">支持 JPG/PNG/WebP，最大 5MB</div>
                  </>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={uploading}
            />
          </div>
        </div>

        <div className="form-group">
          <label>标题 (可选)</label>
          <input
            type="text"
            value={form.title}
            maxLength={60}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="留空则不显示标题"
          />
        </div>

        <div className="form-group">
          <label>点击跳转</label>
          <select
            value={form.link_type}
            onChange={(e) =>
              setForm({
                ...form,
                link_type: e.target.value as Banner['link_type'],
                link_value: e.target.value === 'none' ? '' : form.link_value
              })
            }
          >
            <option value="none">不跳转</option>
            <option value="category">跳到指定分类</option>
            <option value="product">跳到指定商品</option>
          </select>
        </div>

        {form.link_type === 'category' && (
          <div className="form-group">
            <label>目标分类</label>
            <select
              value={form.link_value}
              onChange={(e) => setForm({ ...form, link_value: e.target.value })}
            >
              <option value="">请选择</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                  {c.name_en ? ` (${c.name_en})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {form.link_type === 'product' && (
          <div className="form-group">
            <label>目标商品</label>
            <select
              value={form.link_value}
              onChange={(e) => setForm({ ...form, link_value: e.target.value })}
            >
              <option value="">请选择</option>
              {products.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  #{p.id} {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              style={{ width: 'auto', marginRight: 6 }}
            />
            立即启用（顾客可见）
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || uploading}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}