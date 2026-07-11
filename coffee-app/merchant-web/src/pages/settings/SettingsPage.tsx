// filepath: coffee-app/merchant-web/src/pages/settings/SettingsPage.tsx
// 会员等级 + 折扣设置页面
// 商家可在此调整:
//   - level_orders_required: 每 N 单升一级
//   - level_discount_increment: 每级折扣增量 (0.01 = 99 折)
//   - min_discount: 最低折扣上限 (0.80 = 8 折)

import { useEffect, useState } from 'react';
import { api, LevelSettings } from '../../api/client';
import { showToast } from '../../components/Toast';

const DEFAULTS: LevelSettings = {
  level_orders_required: 10,
  level_discount_increment: 0.01,
  min_discount: 0.8
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<LevelSettings>(DEFAULTS);
  const [original, setOriginal] = useState<LevelSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getSettings();
      setSettings(res.data);
      setOriginal(res.data);
    } catch (e: any) {
      showToast(`加载失败：${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const dirty = JSON.stringify(settings) !== JSON.stringify(original);

  // 派生字段：各级折扣 / 多少级到上限
  const previewLevels = computeLevelPreview(settings);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateSettings({
        level_orders_required: Number(settings.level_orders_required),
        level_discount_increment: Number(settings.level_discount_increment),
        min_discount: Number(settings.min_discount)
      });
      setSettings(res.data);
      setOriginal(res.data);
      showToast('已保存设置', 'success');
    } catch (e: any) {
      showToast(`保存失败：${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(original);
  };

  const handleUseDefaults = () => {
    setSettings(DEFAULTS);
  };

  if (loading) {
    return <div className="page-loading">加载中…</div>;
  }

  return (
    <div className="page-settings">
      <div className="settings-header">
        <h2>会员等级 & 折扣设置</h2>
        <p className="muted">
          调整会员升级节奏与每级折扣幅度。已有用户的等级不会因参数变化而
          重算（按新参数下次升级时生效）。
        </p>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <label className="field">
            <div className="field-label">每多少单升一级</div>
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={settings.level_orders_required}
              onChange={(e) =>
                setSettings({ ...settings, level_orders_required: Number(e.target.value) })
              }
            />
            <div className="field-hint">范围 1–10000 的整数，建议 5–20</div>
          </label>

          <label className="field">
            <div className="field-label">每级折扣增量</div>
            <input
              type="number"
              min={0.001}
              max={0.5}
              step={0.005}
              value={settings.level_discount_increment}
              onChange={(e) =>
                setSettings({ ...settings, level_discount_increment: Number(e.target.value) })
              }
            />
            <div className="field-hint">
              范围 0.001–0.5。例 0.01 = 每升 1 级，商品按原价的 99% 出售（即 99 折）
            </div>
          </label>

          <label className="field">
            <div className="field-label">最低折扣（封顶）</div>
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.01}
              value={settings.min_discount}
              onChange={(e) =>
                setSettings({ ...settings, min_discount: Number(e.target.value) })
              }
            />
            <div className="field-hint">
              范围 0.10–1.00。例 0.80 = 最低按 8 折出售，不会更便宜。
              （1.00 = 不打折）
            </div>
          </label>

          <div className="action-row">
            <button
              className="btn btn-primary"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button className="btn" disabled={!dirty || saving} onClick={handleReset}>
              撤销
            </button>
            <button className="btn btn-link" disabled={saving} onClick={handleUseDefaults}>
              恢复默认值
            </button>
          </div>
        </div>

        <div className="settings-card preview-card">
          <div className="card-title">预览</div>
          <table className="preview-table">
            <thead>
              <tr>
                <th>等级</th>
                <th>折扣</th>
                <th>示例价格</th>
              </tr>
            </thead>
            <tbody>
              {previewLevels.map((p) => (
                <tr key={p.level}>
                  <td>Lv.{p.level}</td>
                  <td>{p.discountText}</td>
                  <td>¥{p.examplePrice.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="preview-note muted">
            示例价格按原价 ¥20.00 计算。最高等级 = 折扣达到
            <code> min_discount </code>的级别。
          </div>
        </div>
      </div>
    </div>
  );
}

// 生成等级预览 (Lv.1, 2, 5, 10, 20, 30, 50, 100)
function computeLevelPreview(s: LevelSettings) {
  const levels = [1, 2, 5, 10, 20, 30, 50, 100];
  return levels.map((lvl) => {
    const raw = 1.0 - (lvl - 1) * s.level_discount_increment;
    const clamped = Math.max(s.min_discount, Math.min(1.0, raw));
    const multiplier = Math.round(clamped * 10000) / 10000;
    // 文案: 0.99 → "99折", 0.80 → "8折", 1.0 → "不打折"
    let discountText;
    if (multiplier >= 0.999) discountText = '不打折';
    else discountText = `${Math.round(multiplier * 100)}折`;
    return {
      level: lvl,
      multiplier,
      discountText,
      examplePrice: 20 * multiplier
    };
  });
}