import { useState } from 'react';
import { NumberInput, Sheet, TopBar } from '../components/ui';
import { db, importPresetFoods } from '../domain/db';
import { CATEGORY_LABEL, SLOTS, SLOT_LABEL, UNIT_LABEL, type FoodCategory, type FoodItem, type MealSlot, type Unit } from '../domain/types';
import { useFoods } from '../hooks';

export default function FoodLibrary() {
  const foods = useFoods() ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<Partial<FoodItem> | null>(null);
  const list = foods
    .filter((f) => (showHidden || !f.hidden) && (!q || f.name.includes(q)) && (!cat || f.category === cat))
    .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name, 'zh'));

  async function save() {
    const e = editing!;
    if (!e.name || e.kcal === undefined) return alert('名称和热量必填');
    const unit = e.unit ?? 'g';
    // 不带 source：用户在这里保存过，就视为已核对，去掉「AI 估算」标记
    await db.foods.put({
      id: e.id, name: e.name, category: e.category ?? 'other', unit, per: unit === 'g' || unit === 'ml' ? 100 : 1,
      kcal: e.kcal, protein: e.protein ?? 0, carbs: e.carbs ?? 0, fat: e.fat ?? 0,
      defaultAmount: e.defaultAmount ?? (unit === 'g' || unit === 'ml' ? 100 : 1),
      slots: e.slots ?? ['lunch', 'dinner'], autoPlan: e.autoPlan ?? true, inStock: e.inStock ?? false, useCount: e.useCount ?? 0, hidden: false, builtin: e.builtin,
    });
    setEditing(null);
  }
  async function remove(f: FoodItem) {
    const used = (await db.mealLogs.toArray()).some((l) => l.items.some((i) => i.foodId === f.id));
    if (used) { await db.foods.update(f.id!, { hidden: true }); return; }
    if (confirm(`删除「${f.name}」？`)) await db.foods.delete(f.id!);
  }

  return (
    <>
      <TopBar title="食物库" right={<button className="sm primary" onClick={() => setEditing({ unit: 'g', category: 'protein', slots: ['lunch', 'dinner'], autoPlan: true })}>＋ 新增</button>} />
      <input placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row wrap" style={{ margin: '8px 0' }}>
        <button className={`sm ${cat === '' ? 'primary' : ''}`} onClick={() => setCat('')}>全部</button>
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => <button key={k} className={`sm ${cat === k ? 'primary' : ''}`} onClick={() => setCat(k)}>{v}</button>)}
      </div>
      <div className="card">
        <ul className="list">
          {list.map((f) => (
            <li key={f.id} className={f.hidden ? 'done' : ''}>
              <div className="grow">
                <span className="name">{f.name}</span> <span className="muted small">{CATEGORY_LABEL[f.category]}{f.autoPlan ? '' : ' · 不进计划'}{f.source === 'ai' ? ' · AI 估算待核对' : ''}</span>
                <div className="muted small">{f.kcal} kcal · 蛋白 {f.protein} · 碳水 {f.carbs} · 脂肪 {f.fat} / {f.per}{UNIT_LABEL[f.unit]} · 默认 {f.defaultAmount}{UNIT_LABEL[f.unit]}</div>
              </div>
              <button className="sm ghost" onClick={() => setEditing(f)}>改</button>
              {f.hidden ? <button className="sm ghost" onClick={() => db.foods.update(f.id!, { hidden: false })}>恢复</button> : <button className="sm ghost" onClick={() => remove(f)}>✕</button>}
            </li>
          ))}
          {list.length === 0 && <li className="muted">没有食物</li>}
        </ul>
      </div>
      <div className="row">
        <button className="sm ghost" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '收起已隐藏' : '显示已隐藏'}</button>
        <button className="sm ghost" onClick={async () => alert(`导入了 ${await importPresetFoods()} 种预置食材`)}>导入预置食材</button>
      </div>
      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2>{editing.id ? '编辑食物' : '新增食物'}</h2>
          {editing.source === 'ai' && <p className="hint">营养值是 AI 估算的。对照包装营养成分表或食物成分表核对，保存后就不再标记「AI 估算」。</p>}
          <label>名称</label>
          <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <div className="grid2">
            <div><label>分类</label>
              <select value={editing.category ?? 'other'} onChange={(e) => setEditing({ ...editing, category: e.target.value as FoodCategory })}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label>单位</label>
              <select value={editing.unit ?? 'g'} onChange={(e) => setEditing({ ...editing, unit: e.target.value as Unit })}>
                {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <p className="hint">营养值按每 100 克 / 100 毫升填；按个、份时按每 1 个 / 1 份填。</p>
          <div className="grid2">
            <div><label>热量 kcal</label><NumberInput value={editing.kcal} onChange={(v) => setEditing({ ...editing, kcal: v })} /></div>
            <div><label>蛋白质 g</label><NumberInput value={editing.protein} onChange={(v) => setEditing({ ...editing, protein: v })} step={0.1} /></div>
            <div><label>碳水 g</label><NumberInput value={editing.carbs} onChange={(v) => setEditing({ ...editing, carbs: v })} step={0.1} /></div>
            <div><label>脂肪 g</label><NumberInput value={editing.fat} onChange={(v) => setEditing({ ...editing, fat: v })} step={0.1} /></div>
          </div>
          <label>默认份量</label>
          <NumberInput value={editing.defaultAmount} onChange={(v) => setEditing({ ...editing, defaultAmount: v })} suffix={UNIT_LABEL[editing.unit ?? 'g']} />
          <label>适用餐次</label>
          <div className="row wrap">
            {SLOTS.map((s: MealSlot) => {
              const sel = (editing.slots ?? []).includes(s);
              return <button key={s} className={`sm ${sel ? 'primary' : ''}`} onClick={() => setEditing({ ...editing, slots: sel ? (editing.slots ?? []).filter((x) => x !== s) : [...(editing.slots ?? []), s] })}>{SLOT_LABEL[s]}</button>;
            })}
          </div>
          <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={editing.autoPlan ?? true} onChange={(e) => setEditing({ ...editing, autoPlan: e.target.checked })} /><span>参与自动生成计划</span></label>
          <button className="primary block" style={{ marginTop: 12 }} onClick={save}>保存</button>
        </Sheet>
      )}
    </>
  );
}
