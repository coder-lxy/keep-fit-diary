import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { NumberInput, Sheet, TopBar } from '../components/ui';
import { db } from '../domain/db';
import { BODY_PART_LABEL, type BodyPart, type StrengthExercise } from '../domain/types';

export default function ExerciseLibrary() {
  const list = useLiveQuery(() => db.strengthExercises.toArray(), []) ?? [];
  const [editing, setEditing] = useState<Partial<StrengthExercise> | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  async function save() {
    if (!editing?.name) return;
    const row: StrengthExercise = {
      id: editing.id, name: editing.name, bodyPart: editing.bodyPart ?? 'leg',
      defaultSets: editing.defaultSets ?? 3, defaultReps: editing.defaultReps ?? 12,
      weighted: editing.weighted ?? false, builtin: editing.builtin ?? false, hidden: false,
    };
    await db.strengthExercises.put(row);
    setEditing(null);
  }

  return (
    <>
      <TopBar title="动作库" right={<button className="sm primary" onClick={() => setEditing({ defaultSets: 3, defaultReps: 12 })}>＋ 新增</button>} />
      <div className="card">
        <ul className="list">
          {list.filter((e) => showHidden || !e.hidden).map((e) => (
            <li key={e.id} className={e.hidden ? 'done' : ''}>
              <div className="grow">
                <span className="name">{e.name}</span>
                <div className="muted small">{BODY_PART_LABEL[e.bodyPart]} · 默认 {e.defaultSets}×{e.defaultReps}{e.weighted ? ' · 负重' : ''}</div>
              </div>
              <button className="sm ghost" onClick={() => setEditing(e)}>改</button>
              <button className="sm ghost" onClick={() => db.strengthExercises.update(e.id!, { hidden: !e.hidden })}>{e.hidden ? '恢复' : '隐藏'}</button>
            </li>
          ))}
        </ul>
        <button className="sm ghost" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '收起已隐藏' : '显示已隐藏'}</button>
      </div>
      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2>{editing.id ? '编辑动作' : '新增动作'}</h2>
          <label>名称</label>
          <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <label>部位</label>
          <select value={editing.bodyPart ?? 'leg'} onChange={(e) => setEditing({ ...editing, bodyPart: e.target.value as BodyPart })}>
            {Object.entries(BODY_PART_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="grid2">
            <div><label>默认组数</label><NumberInput value={editing.defaultSets} onChange={(v) => setEditing({ ...editing, defaultSets: v })} /></div>
            <div><label>默认次数</label><NumberInput value={editing.defaultReps} onChange={(v) => setEditing({ ...editing, defaultReps: v })} /></div>
          </div>
          <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={editing.weighted ?? false} onChange={(e) => setEditing({ ...editing, weighted: e.target.checked })} /><span>负重动作（打卡时记重量）</span></label>
          <button className="primary block" style={{ marginTop: 12 }} onClick={save}>保存</button>
        </Sheet>
      )}
    </>
  );
}
