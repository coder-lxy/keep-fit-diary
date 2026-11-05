import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { TopBar } from '../components/ui';
import { addDays, diffDays, today } from '../domain/dates';
import { db } from '../domain/db';
import { generatePlanForDate } from '../services/planService';

export default function Period() {
  const list = useLiveQuery(() => db.periods.orderBy('start').reverse().toArray(), []) ?? [];
  const profile = useLiveQuery(() => db.profile.get(1), []);
  const [start, setStart] = useState(today());
  const [error, setError] = useState('');
  const open = list.find((p) => !p.end || p.end >= today());

  const starts = [...list].reverse().map((p) => p.start);
  let avgCycle = profile?.cycleDays ?? 28;
  if (starts.length >= 2) {
    const gaps = starts.slice(1).map((s, i) => diffDays(s, starts[i]));
    avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }
  const next = starts.length ? addDays(starts[starts.length - 1], avgCycle) : undefined;

  // 经期变动后让今天的排期重新决定：之前手动换过类型的话也以经期规则为准。
  async function refreshToday() {
    setError('');
    const plan = await db.plans.where('date').equals(today()).first();
    if (!plan) return;
    try {
      await generatePlanForDate(today(), { resetDayType: true });
    } catch (e) {
      setError(`今日计划更新失败：${e instanceof Error ? e.message : '请重试'}`);
    }
  }
  async function begin() {
    const end = addDays(start, (profile?.periodDays ?? 5) - 1);
    await db.periods.add({ start, end });
    await refreshToday();
  }
  async function setEnd(id: number, end: string) {
    await db.periods.update(id, { end });
    await refreshToday();
  }
  async function remove(id: number) {
    if (!confirm('删除这条经期记录？')) return;
    await db.periods.delete(id);
    await refreshToday();
  }

  return (
    <>
      <TopBar title="生理期" />
      <div className="card">
        {error && <p className="notice small" role="alert">{error}</p>}
        {open ? (
          <>
            <p>经期中：{open.start} 起{open.end ? `，预计 ${open.end} 结束` : ''}</p>
            <label>实际结束日期</label>
            <input type="date" value={open.end ?? ''} onChange={(e) => setEnd(open.id!, e.target.value)} />
            <p className="hint">经期内运动自动休息，热量预算 +150，体重不参与趋势判断。</p>
          </>
        ) : (
          <>
            <label>标记经期开始</label>
            <div className="row period-start">
              <input type="date" value={start} max={today()} onChange={(e) => setStart(e.target.value)} />
              <button className="sm primary" onClick={begin}>开始</button>
            </div>
            {next && <p className="hint">按平均周期 {avgCycle} 天推算，下次约在 {next}{diffDays(next, today()) <= 2 && diffDays(next, today()) >= 0 ? '，快到了' : ''}。</p>}
          </>
        )}
      </div>
      <div className="card">
        <h3>历史</h3>
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}>
              <span className="grow">{p.start} ~ {p.end ?? '进行中'}</span>
              <button className="sm ghost" onClick={() => remove(p.id!)}>✕</button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">还没有记录</li>}
        </ul>
      </div>
    </>
  );
}
