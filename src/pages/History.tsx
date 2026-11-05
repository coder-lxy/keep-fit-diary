import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { NumberInput, TopBar } from '../components/ui';
import { nowTime, today } from '../domain/dates';
import { db } from '../domain/db';
import { r1 } from '../hooks';
import { generatePlanForDate } from '../services/planService';

export default function History() {
  const recs = useLiveQuery(() => db.bodyRecords.orderBy('date').reverse().toArray(), []) ?? [];
  const [date, setDate] = useState(today());
  const [w, setW] = useState<number | undefined>();
  const [bf, setBf] = useState<number | undefined>();

  async function save() {
    if (!w) return;
    const existing = recs.find((r) => r.date === date && r.isDaily);
    if (existing) await db.bodyRecords.update(existing.id!, { weightKg: w, bodyFatPct: bf });
    else await db.bodyRecords.add({ date, time: nowTime(), weightKg: w, bodyFatPct: bf, source: 'manual', isDaily: true });
    if (date === today()) await generatePlanForDate(date).catch(() => {});
    setW(undefined); setBf(undefined);
  }

  return (
    <>
      <TopBar title="体重记录" />
      <div className="card">
        <h3>补录 / 修改</h3>
        <label>日期</label>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        <div className="grid2">
          <div><label>体重</label><NumberInput value={w} onChange={setW} step={0.1} suffix="kg" /></div>
          <div><label>体脂率</label><NumberInput value={bf} onChange={setBf} step={0.1} suffix="%" /></div>
        </div>
        <button className="primary block" style={{ marginTop: 10 }} disabled={!w} onClick={save}>保存</button>
      </div>
      <div className="card">
        <ul className="list">
          {recs.map((r) => (
            <li key={r.id}>
              <div className="grow">{r.date} <span className="muted small">{r.time}{r.isDaily ? '' : ' · 非当日有效值'}</span></div>
              <span>{r1(r.weightKg)} kg</span>
              <span className="muted">{r.bodyFatPct ? `${r1(r.bodyFatPct)}%` : ''}</span>
              <button className="sm ghost" onClick={() => { setDate(r.date); setW(r.weightKg); setBf(r.bodyFatPct); }}>改</button>
              <button className="sm ghost" onClick={() => { if (confirm('删除这条记录？')) db.bodyRecords.delete(r.id!); }}>✕</button>
            </li>
          ))}
          {recs.length === 0 && <li className="muted">还没有记录</li>}
        </ul>
      </div>
    </>
  );
}
