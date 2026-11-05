import { useLiveQuery } from 'dexie-react-hooks';
import { NumberInput, TopBar } from '../components/ui';
import { WEEKDAY_CN } from '../domain/dates';
import { db } from '../domain/db';
import { DAY_TYPE_LABEL, type DayType, type WorkoutSchedule } from '../domain/types';

export default function ScheduleSettings() {
  const s = useLiveQuery(() => db.schedule.get(1), []);
  const types = useLiveQuery(() => db.exerciseTypes.toArray(), []) ?? [];
  const exercises = useLiveQuery(() => db.strengthExercises.toArray(), []) ?? [];
  if (!s) return null;
  const save = (patch: Partial<WorkoutSchedule>) => db.schedule.update(1, patch);
  const total = s.cardioPerWeek + s.strengthPerWeek + s.restPerWeek;

  return (
    <>
      <TopBar title="排期设置" />
      <div className="card">
        <h3>排期模式</h3>
        <div className="seg">
          <button className={s.mode === 'auto' ? 'on' : ''} onClick={() => save({ mode: 'auto' })}>自动排期</button>
          <button className={s.mode === 'fixed' ? 'on' : ''} onClick={() => save({ mode: 'fixed' })}>固定星期</button>
        </div>
        {s.mode === 'auto' ? (
          <>
            <p className="hint">每天早晨根据本周剩余次数、昨天的类型和体重趋势决定今天练什么。</p>
            <div className="grid3">
              <div><label>每周有氧</label><NumberInput value={s.cardioPerWeek} onChange={(v) => save({ cardioPerWeek: v ?? 0 })} suffix="次" /></div>
              <div><label>每周力量</label><NumberInput value={s.strengthPerWeek} onChange={(v) => save({ strengthPerWeek: v ?? 0 })} suffix="次" /></div>
              <div><label>每周休息</label><NumberInput value={s.restPerWeek} onChange={(v) => save({ restPerWeek: v ?? 0 })} suffix="次" /></div>
            </div>
            {total !== 7 && <p className="notice">三项合计应为 7，现在是 {total}。</p>}
            <label>最多连续训练天数</label>
            <NumberInput value={s.maxConsecutiveTraining} onChange={(v) => save({ maxConsecutiveTraining: v ?? 3 })} suffix="天" />
          </>
        ) : (
          <ul className="list">
            {s.fixedWeek.map((t, i) => (
              <li key={i}>
                <span className="grow">周{WEEKDAY_CN[i]}</span>
                <select style={{ width: 120 }} value={t} onChange={(e) => { const fw = [...s.fixedWeek]; fw[i] = e.target.value as DayType; save({ fixedWeek: fw }); }}>
                  {(['cardio', 'strength', 'rest'] as DayType[]).map((d) => <option key={d} value={d}>{DAY_TYPE_LABEL[d]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>有氧日默认内容</h3>
        <div className="grid2">
          <div>
            <label>项目</label>
            <select value={s.cardioDefault.exerciseTypeId} onChange={(e) => save({ cardioDefault: { ...s.cardioDefault, exerciseTypeId: Number(e.target.value) } })}>
              {types.filter((t) => t.category === 'cardio').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div><label>目标时长</label><NumberInput value={s.cardioDefault.minutes} onChange={(v) => save({ cardioDefault: { ...s.cardioDefault, minutes: v ?? 30 } })} suffix="分钟" /></div>
        </div>
      </div>

      <div className="card">
        <h3>力量日默认动作</h3>
        <ul className="list">
          {s.strengthDefault.map((st, i) => {
            const e = exercises.find((x) => x.id === st.exerciseId);
            return (
              <li key={st.exerciseId}>
                <span className="grow">{e?.name ?? '?'}</span>
                <input type="number" inputMode="numeric" style={{ width: 60 }} value={st.sets} onChange={(ev) => { const d = [...s.strengthDefault]; d[i] = { ...st, sets: Number(ev.target.value) }; save({ strengthDefault: d }); }} /><span className="small muted">组</span>
                <input type="number" inputMode="numeric" style={{ width: 60 }} value={st.reps} onChange={(ev) => { const d = [...s.strengthDefault]; d[i] = { ...st, reps: Number(ev.target.value) }; save({ strengthDefault: d }); }} /><span className="small muted">次</span>
                <button className="sm ghost" onClick={() => save({ strengthDefault: s.strengthDefault.filter((_, j) => j !== i) })}>✕</button>
              </li>
            );
          })}
        </ul>
        <div className="row wrap">
          {exercises.filter((e) => !e.hidden && !s.strengthDefault.some((d) => d.exerciseId === e.id)).map((e) => (
            <button key={e.id} className="sm" onClick={() => save({ strengthDefault: [...s.strengthDefault, { exerciseId: e.id!, sets: e.defaultSets, reps: e.defaultReps }] })}>＋ {e.name}</button>
          ))}
        </div>
      </div>
    </>
  );
}
