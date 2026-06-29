// filepath: coffee-app/merchant-web/src/pages/products/ProductsPage.tsx
import { useEffect, useRef, useState } from 'react';
import { api, Product } from '../../api/client';
import { API_BASE, resolveImageUrl } from '../../api/config';
import { showToast } from '../../components/Toast';
import { formatPrice } from '../../utils/format';

const CATEGORIES = ['意式咖啡', '其他饮品', '创意特调'];

interface ProductFormData {
  id?: number;
  name: string;
  category: string;
  price: string;
  description: string;
  image_url: string;
  available: boolean;
}

const emptyForm: ProductFormData = {
  name: '',
  category: '意式咖啡',
  price: '',
  description: '',
  image_url: '',
  available: true
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [editing, setEditing] = useState<ProductFormData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listProducts();
      setProducts(res.data);
    } catch (e: any) {
      showToast(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = filter === 'all' ? products : products.filter((p) => p.category === filter);

  const handleToggleAvailable = async (p: Product) => {
    try {
      await api.updateProduct(p.id, { available: p.available ? 0 : 1 });
      showToast(`${p.name} 已${p.available ? '下架' : '上架'}`, 'success');
      load();
    } catch (e: any) {
      showToast(`操作失败：${e.message}`, 'error');
    }
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`确定删除「${p.name}」？`)) return;
    try {
      await api.deleteProduct(p.id);
      showToast(`已删除 ${p.name}`, 'success');
      load();
    } catch (e: any) {
      showToast(`删除失败：${e.message}`, 'error');
    }
  };

  const openCreate = () => setEditing({ ...emptyForm });
  const openEdit = (p: Product) =>
    setEditing({
      id: p.id,
      name: p.name,
      category: p.category,
      price: String(p.price),
      description: p.description || '',
      image_url: p.image_url || '',
      available: !!p.available
    });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">商品管理</h2>
        <button className="btn btn-primary" onClick={openCreate}>
          + 添加商品
        </button>
      </div>

      <div className="filter-bar">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          全部 ({products.length})
        </button>
        {CATEGORIES.map((cat) => {
          const cnt = products.filter((p) => p.category === cat).length;
          return (
            <button
              key={cat}
              className={`chip ${filter === cat ? 'active' : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat} ({cnt})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="empty">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="empty">暂无商品</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>图</th>
              <th style={{ width: 50 }}>排序</th>
              <th>名称</th>
              <th>分类</th>
              <th style={{ width: 100 }}>价格</th>
              <th style={{ width: 100 }}>状态</th>
              <th style={{ width: 200 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.image_url ? (
                    <img
                      src={resolveImageUrl(p.image_url) || ''}
                      alt={p.name}
                      className="product-thumb"
                    />
                  ) : (
                    <div className="product-thumb-placeholder">无图</div>
                  )}
                </td>
                <td>{p.sort_order}</td>
                <td>
                  <strong>{p.name}</strong>
                  {p.description && (
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                      {p.description}
                    </div>
                  )}
                </td>
                <td>
                  <span className="badge">{p.category}</span>
                </td>
                <td>{formatPrice(p.price)}</td>
                <td>
                  {p.available ? (
                    <span className="status status-completed">上架中</span>
                  ) : (
                    <span className="status status-cancelled">已下架</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-sm" onClick={() => openEdit(p)}>
                      编辑
                    </button>
                    <button className="btn btn-sm" onClick={() => handleToggleAvailable(p)}>
                      {p.available ? '下架' : '上架'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <ProductFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── Product Form Modal (with image upload) ──────────────────────

function ProductFormModal({
  initial,
  onClose,
  onSaved
}: {
  initial: ProductFormData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductFormData>(initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
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

      const apiBase = API_BASE;
      const MERCHANT_TOKEN = 'merchant-local-token';
      const res = await fetch(`${apiBase}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MERCHANT_TOKEN}` },
        body: fd
      });

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

  const handleRemoveImage = () => {
    setForm((f) => ({ ...f, image_url: '' }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast('请输入商品名称', 'error');
      return;
    }
    const price = parseFloat(form.price);
    if (isNaN(price) || price < 0) {
      showToast('请输入有效价格', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        price,
        description: form.description.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        available: form.available ? 1 : 0
      };
      if (form.id) {
        await api.updateProduct(form.id, payload);
        showToast('已更新', 'success');
      } else {
        await api.createProduct(payload);
        showToast('已添加', 'success');
      }
      onSaved();
    } catch (e: any) {
      showToast(`保存失败：${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h3 className="panel-title" style={{ marginBottom: 20 }}>
          {form.id ? '编辑商品' : '添加商品'}
        </h3>

        <div className="form-group">
          <label>名称</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：美式咖啡"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>分类</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>价格 (¥)</label>
          <input
            type="number"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="0.00"
          />
        </div>

        <div className="form-group">
          <label>描述</label>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="可选"
          />
        </div>

        <div className="form-group">
          <label>商品图片</label>
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
                    onClick={handleRemoveImage}
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
                    <div className="upload-icon">📷</div>
                    <div>点击上传图片</div>
                    <div className="upload-hint">支持 JPG/PNG/GIF/WebP/SVG，最大 5MB</div>
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
          {form.image_url && (
            <div className="image-url-display">URL: {form.image_url}</div>
          )}
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={form.available}
              onChange={(e) => setForm({ ...form, available: e.target.checked })}
              style={{ width: 'auto', marginRight: 6 }}
            />
            立即上架（顾客可见）
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || uploading}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
