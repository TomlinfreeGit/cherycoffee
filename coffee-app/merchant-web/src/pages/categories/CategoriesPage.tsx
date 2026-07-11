// filepath: coffee-app/merchant-web/src/pages/categories/CategoriesPage.tsx
import { useEffect, useState } from 'react';
import { api, Category } from '../../api/client';
import { showToast } from '../../components/Toast';

export default function CategoriesPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listCategories();
      setCats(res.data);
    } catch (e: any) {
      showToast(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (data: { name: string; icon: string }) => {
    try {
      await api.createCategory(data);
      showToast('已创建分类', 'success');
      setCreating(false);
      load();
    } catch (e: any) {
      showToast(`创建失败：${e.message}`, 'error');
    }
  };

  const handleSave = async (id: number, data: { name: string; icon: string }) => {
    try {
      await api.updateCategory(id, data);
      showToast('已保存', 'success');
      setEditing(null);
      load();
    } catch (e: any) {
      showToast(`保存失败：${e.message}`, 'error');
    }
  };

  const handleDelete = async (c: Category) => {
    const ok = window.confirm(
      `确定删除分类「${c.name}」？\n\n` +
      `该分类下的 ${c.product_count} 个商品的分类将被清空（商品保留但不再显示在菜单分类下）。`
    );
    if (!ok) return;
    setDeletingId(c.id);
    try {
      const res = await api.deleteCategory(c.id);
      showToast(
        `已删除「${c.name}」，${res.data.detached_products} 个商品的分类已清空`,
        'success'
      );
      load();
    } catch (e: any) {
      showToast(`删除失败：${e.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">菜单分类</h2>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + 添加分类
        </button>
      </div>

      {loading ? (
        <div className="empty">加载中...</div>
      ) : cats.length === 0 ? (
        <div className="empty">暂无分类，点上方"添加分类"开始</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>图标</th>
              <th>分类名称</th>
              <th style={{ width: 100 }}>商品数</th>
              <th style={{ width: 100 }}>排序</th>
              <th style={{ width: 220 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td style={{ fontSize: 24 }}>{c.icon || '—'}</td>
                <td><strong>{c.name}</strong></td>
                <td>{c.product_count}</td>
                <td>{c.sort_order}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      编辑
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(c)}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id ? '删除中...' : '删除'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <CategoryEditor
          title="添加分类"
          onCancel={() => setCreating(false)}
          onSave={handleCreate}
        />
      )}

      {editing && (
        <CategoryEditor
          title={`编辑「${editing.name}」`}
          initial={{ name: editing.name, icon: editing.icon || '' }}
          onCancel={() => setEditing(null)}
          onSave={(data) => handleSave(editing.id, data)}
        />
      )}
    </div>
  );
}

interface CategoryEditorProps {
  title: string;
  initial?: { name: string; icon: string };
  onCancel: () => void;
  onSave: (data: { name: string; icon: string }) => void;
}

function CategoryEditor({ title, initial, onCancel, onSave }: CategoryEditorProps) {
  const [name, setName] = useState(initial?.name || '');
  const [icon, setIcon] = useState(initial?.icon || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('请输入分类名称', 'error');
      return;
    }
    if (trimmed.length > 20) {
      showToast('分类名称过长（最多 20 字符）', 'error');
      return;
    }
    onSave({ name: trimmed, icon: icon.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-body">
          <div className="form-group">
            <label>分类名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              placeholder="例如：意式咖啡"
            />
          </div>
          <div className="form-group">
            <label>图标（emoji，可选）</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              placeholder="☕ / 🥤 / 🍹"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}