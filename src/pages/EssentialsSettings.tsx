import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { NumberInput, Sheet, TopBar } from '../components/ui';
import { db } from '../domain/db';
import { DAY_TYPE_LABEL, type DayType, type EssentialItem } from '../domain/types';

export default function EssentialsSettings() {
  const list = useLiveQuery(() => db.essentials.orderBy('order').toArray(), []) ?? [];
  const [editing, setEditing] = useState<Partial<EssentialItem> | null>(null);

  async function save() {
    if (!editing?.name) return;
    await db.essentials.put({
      id: editing.id, name: editing.name, note: editing.note, minutes: editing.minutes,
      dayTypes: editing.dayTypes ?? ['cardio', 'strength'], order: editing.order ?? list.length + 1, enabled: editing.enabled ?? true,
    });
    setEditing(null);
  }
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    await db.essentials.update(list[i].id!, { order: list[j].order });
    await db.essentials.update(list[j].id!, { order: list[i].order });
  }

  return (
    <>
      <TopBar title="必练清单" right={<button className="sm primary" onClick={() => setEditing({})}>＋ 新增</button>} />
      <p className="muted small">每天训练前要做的固定项目，比如八段锦、拉伸。打卡页逐项勾选。</p>
      <div className="card">
        <ul className="list">
          {list.map((e, i) => (
            <li key={e.id} className={e.enabled ? '' : 'done'}>
              <input type="checkbox" checked={e.enabled} onChange={(ev) => db.essentials.update(e.id!, { enabled: ev.target.checked })} />
              <div className="grow">
                <span className="name">{e.name}</span>
                <div className="muted small">{e.dayTypes.map((t) => DAY_TYPE_LABEL[t]).join('、')}{e.minutes ? ` · ${e.minutes} 分钟` : ''}</div>
              </div>
              <button className="sm ghost" onClick={() => move(i, -1)}>↑</button>
              <button className="sm ghost" onClick={() => move(i, 1)}>↓</button>
              <button className="sm ghost" onClick={() => setEditing(e)}>改</button>
              <button className="sm ghost" onClick={() => { if (confirm(`删除「${e.name}」？`)) db.essentials.delete(e.id!); }}>✕</button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">还没有必练项目</li>}
        </ul>
      </div>
      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2>{editing.id ? '编辑' : '新增必练项'}</h2>
          <label>名称</label>
          <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例如：八段锦" />
          <label>说明（选填）</label>
          <input value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          <label>预计时长（选填）</label>
          <NumberInput value={editing.minutes} onChange={(v) => setEditing({ ...editing, minutes: v })} suffix="分钟" />
          <label>适用日类型</label>
          <div className="row wrap">
            {(['cardio', 'strength', 'rest'] as DayType[]).map((t) => {
              const sel = (editing.dayTypes ?? ['cardio', 'strength']).includes(t);
              return <button key={t} className={`sm ${sel ? 'primary' : ''}`} onClick={() => {
                const cur = editing.dayTypes ?? ['cardio', 'strength'];
                setEditing({ ...editing, dayTypes: sel ? cur.filter((x) => x !== t) : [...cur, t] });
              }}>{DAY_TYPE_LABEL[t]}</button>;
            })}
          </div>
          <button className="primary block" style={{ marginTop: 12 }} onClick={save}>保存</button>
        </Sheet>
      )}
    </>
  );
}
