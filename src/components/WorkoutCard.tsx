import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { db } from '../domain/db';
import { cardioKcal } from '../domain/rules/exercise';
import { DAY_TYPE_LABEL, type DailyPlan, type DayType, type EssentialItem, type ExerciseType, type StrengthExercise, type StrengthSet, type WorkoutLog } from '../domain/types';
import { generatePlanForDate } from '../services/planService';
import { addStrength, removeStrength, saveCardio, saveStrength, setEssentialDone, undoStrength } from '../services/workoutService';

type Cardio = NonNullable<WorkoutLog['cardio']>;

export default function WorkoutCard({ plan, log }: { plan: DailyPlan; log: WorkoutLog }) {
  const essentials = useLiveQuery(() => db.essentials.toArray(), []) ?? [];
  const exercises = useLiveQuery(() => db.strengthExercises.toArray(), []) ?? [];
  const types = useLiveQuery(() => db.exerciseTypes.toArray(), []) ?? [];
  const [switching, setSwitching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const todayEssentials = plan.dayType === 'rest' ? [] : plan.essentialIds.map((id) => essentials.find((e) => e.id === id)).filter((e) => !!e);
  const planned = plan.dayType === 'strength' ? plan.strength ?? [] : [];
  // 旧版本手动添加的动作只存在实际记录里，从记录带入，仍能查看和修改。
  const strengthRows = plan.dayType === 'strength' ? [...planned, ...log.strengthDone.filter((done) => !planned.some((item) => item.exerciseId === done.exerciseId))] : [];
  const total = todayEssentials.length + (plan.dayType === 'cardio' ? 1 : 0) + strengthRows.length;
  const doneCount = todayEssentials.filter((e) => log.essentialsDone.some((d) => d.essentialId === e.id)).length
    + (plan.dayType === 'cardio' && log.cardio ? 1 : 0)
    + strengthRows.filter((row) => log.strengthDone.some((d) => d.exerciseId === row.exerciseId)).length;

  async function changeDayType(t: DayType) {
    if (busy || t === plan.dayType) return;
    setBusy(true);
    setError('');
    try {
      await generatePlanForDate(plan.date, { manualDayType: t });
      setSwitching(false);
    } catch (e) {
      setError(`切换失败：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      setBusy(false);
    }
  }

  async function add(set: StrengthSet) {
    setError('');
    try {
      await addStrength(plan, set);
      setAdding(false);
    } catch (e) {
      setError(`添加失败：${e instanceof Error ? e.message : '请重试'}`);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <h2>运动</h2>
          <span className="muted small">{DAY_TYPE_LABEL[plan.dayType]}{total > 0 && !log.completed ? ` · ${doneCount} / ${total}` : ''}</span>
          {log.completed && plan.dayType !== 'rest' && <span className="pill">✓ 已完成</span>}
        </div>
        <button className="sm ghost" disabled={busy} onClick={() => setSwitching(!switching)}>换类型</button>
      </div>
      {switching && (
        <div className="seg" style={{ marginBottom: 8 }}>
          {(['cardio', 'strength', 'rest'] as DayType[]).map((t) => (
            <button key={t} className={plan.dayType === t ? 'on' : ''} disabled={busy} aria-pressed={plan.dayType === t} onClick={() => changeDayType(t)}>{DAY_TYPE_LABEL[t]}</button>
          ))}
        </div>
      )}
      {error && <p className="notice small" role="alert">{error}</p>}

      {plan.dayType === 'rest' && <p className="muted small">今天休息，好好恢复。</p>}

      {todayEssentials.map((e) => (
        <EssentialRow key={e.id} plan={plan} essential={e} done={log.essentialsDone.some((d) => d.essentialId === e.id)} />
      ))}

      {plan.dayType === 'cardio' && <CardioRow plan={plan} actual={log.cardio} types={types} />}

      {strengthRows.map((row) => (
        <StrengthRow key={row.exerciseId} plan={plan} planned={row}
          actual={log.strengthDone.find((done) => done.exerciseId === row.exerciseId)}
          exercise={exercises.find((exercise) => exercise.id === row.exerciseId)} />
      ))}

      {plan.dayType === 'strength' && (
        <div className="workout-add">
          {strengthRows.length === 0 && <p className="muted small">排期设置里还没配力量动作，可以在这里加。</p>}
          <button className="sm ghost" onClick={() => setAdding(!adding)}>＋ 加动作</button>
          {adding && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              {exercises.filter((exercise) => !exercise.hidden && !strengthRows.some((row) => row.exerciseId === exercise.id)).map((exercise) => (
                <button key={exercise.id} className="sm" onClick={() => add({ exerciseId: exercise.id!, sets: exercise.defaultSets, reps: exercise.defaultReps })}>{exercise.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function persist(action: () => Promise<void>): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, setError, persist };
}

function Row({ done, title, meta, children, actions, error }: {
  done: boolean; title: string; meta?: string; children?: ReactNode; actions: ReactNode; error?: string;
}) {
  return (
    <div className={`meal-row workout-row${done ? ' done' : ''}`}>
      <div className="meal-details">
        <div className="meal-title">
          <strong>{done && <span aria-label="已完成" style={{ color: 'var(--accent)' }}>✓ </span>}{title}</strong>
          {meta && <span className="meal-kcal">{meta}</span>}
        </div>
        {children}
        {error && <div className="meal-warning" role="alert">{title}：{error}</div>}
      </div>
      <div className="meal-actions">{actions}</div>
    </div>
  );
}

function EssentialRow({ plan, essential, done }: { plan: DailyPlan; essential: EssentialItem; done: boolean }) {
  const { saving, error, persist } = useSaving();
  return (
    <Row done={done} title={essential.name} meta={essential.minutes ? `${essential.minutes} 分钟` : undefined} error={error}
      actions={done
        ? <button className="sm ghost" disabled={saving} onClick={() => persist(() => setEssentialDone(plan, essential.id!, false))}>撤销</button>
        : <button className="sm primary" disabled={saving} onClick={() => persist(() => setEssentialDone(plan, essential.id!, true))}>完成</button>}>
      {essential.note && <div className="muted meal-foods">{essential.note}</div>}
    </Row>
  );
}

function CardioRow({ plan, actual, types }: { plan: DailyPlan; actual?: Cardio; types: ExerciseType[] }) {
  const { saving, error, setError, persist } = useSaving();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ typeId: 0, minutes: '', kcal: '' });
  const values = actual ?? plan.cardio;
  const name = types.find((t) => t.id === values?.exerciseTypeId)?.name ?? '有氧';
  const draftType = types.find((t) => t.id === draft.typeId);
  const estimate = draftType && Number(draft.minutes) > 0 ? cardioKcal(draftType.met, plan.basisWeightKg, Number(draft.minutes)) : 0;

  function startEditing() {
    setDraft({ typeId: values?.exerciseTypeId ?? types.find((t) => t.category === 'cardio')?.id ?? 0, minutes: values ? String(values.minutes) : '', kcal: '' });
    setError('');
    setEditing(true);
  }

  async function save() {
    const minutes = Number(draft.minutes);
    const kcal = draft.kcal.trim() === '' ? estimate : Number(draft.kcal);
    if (!draftType) return setError('请选择有氧项目');
    if (!Number.isFinite(minutes) || minutes <= 0) return setError('时长请填写大于 0 的数字');
    if (!Number.isFinite(kcal) || kcal < 0) return setError('消耗请填写大于或等于 0 的数字');
    if (await persist(() => saveCardio(plan, { exerciseTypeId: draftType.id!, minutes, kcal: Math.round(kcal) }))) setEditing(false);
  }

  const actions = editing ? (
    <>
      <button className="sm primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>
      <button className="sm ghost" disabled={saving} aria-label={`取消修改${name}`} onClick={() => { setEditing(false); setError(''); }}>×</button>
    </>
  ) : (
    <>
      <button className="sm ghost" disabled={saving} onClick={startEditing}>修改</button>
      {actual
        ? <button className="sm ghost" disabled={saving} onClick={() => persist(() => saveCardio(plan, undefined))}>撤销</button>
        : plan.cardio && <button className="sm primary" disabled={saving} onClick={() => persist(() => saveCardio(plan, plan.cardio))}>完成</button>}
    </>
  );

  return (
    <Row done={!!actual} title={name} meta={values && !editing ? `${actual ? '' : '约 '}${values.kcal} kcal` : undefined} error={error} actions={actions}>
      {editing ? (
        <div className="workout-edit">
          <select aria-label="有氧项目" disabled={saving} value={draft.typeId} onChange={(e) => setDraft({ ...draft, typeId: Number(e.target.value) })}>
            {types.filter((t) => t.category === 'cardio').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="field-chip">
            <input type="number" inputMode="numeric" min={1} aria-label="有氧时长（分钟）" disabled={saving} value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: e.target.value })} />分钟
          </label>
          <label className="field-chip">
            <input className="wide" type="number" inputMode="numeric" min={0} aria-label="有氧消耗（kcal）" placeholder={String(estimate)} disabled={saving} value={draft.kcal} onChange={(e) => setDraft({ ...draft, kcal: e.target.value })} />kcal
          </label>
        </div>
      ) : values && <div className="muted meal-foods">{actual ? '' : '计划 '}{values.minutes} 分钟</div>}
    </Row>
  );
}

function StrengthRow({ plan, planned, actual, exercise }: {
  plan: DailyPlan;
  planned: StrengthSet;
  actual?: StrengthSet;
  exercise?: Pick<StrengthExercise, 'name' | 'weighted'>;
}) {
  const { saving, error, setError, persist } = useSaving();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ sets: '', reps: '', weightKg: '' });
  const values = actual ?? planned;
  const name = exercise?.name ?? '未知动作';

  function startEditing() {
    setDraft({ sets: String(values.sets), reps: String(values.reps), weightKg: values.weightKg === undefined ? '' : String(values.weightKg) });
    setError('');
    setEditing(true);
  }

  async function save() {
    const sets = Number(draft.sets);
    const reps = Number(draft.reps);
    const weightKg = exercise?.weighted && draft.weightKg.trim() !== '' ? Number(draft.weightKg) : undefined;
    if (!Number.isInteger(sets) || sets <= 0 || !Number.isInteger(reps) || reps <= 0) return setError('组数和次数请填写大于 0 的整数');
    if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg < 0)) return setError('重量请填写大于或等于 0 的数字');
    if (await persist(() => saveStrength(plan, { exerciseId: planned.exerciseId, sets, reps, weightKg }))) setEditing(false);
  }

  const actions = editing ? (
    <>
      <button className="sm primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>
      <button className="sm ghost" disabled={saving} aria-label={`取消修改${name}`} onClick={() => { setEditing(false); setError(''); }}>×</button>
    </>
  ) : (
    <>
      <button className="sm ghost workout-remove" disabled={saving} onClick={() => persist(() => removeStrength(plan, planned.exerciseId))}>移除</button>
      <button className="sm ghost" disabled={saving} onClick={startEditing}>修改</button>
      {actual
        ? <button className="sm ghost" disabled={saving} onClick={() => persist(() => undoStrength(plan, planned.exerciseId))}>撤销</button>
        : <button className="sm primary" disabled={saving} onClick={() => persist(() => saveStrength(plan, { ...planned }))}>完成</button>}
    </>
  );

  return (
    <Row done={!!actual} title={name} error={error} actions={actions}>
      {editing ? (
        <div className="workout-edit">
          <label className="field-chip">
            <input autoFocus type="number" inputMode="numeric" min={1} step={1} aria-label={`${name}实际组数`} disabled={saving} value={draft.sets} onChange={(event) => setDraft({ ...draft, sets: event.target.value })} />组
          </label>
          <label className="field-chip">
            <input type="number" inputMode="numeric" min={1} step={1} aria-label={`${name}实际次数`} disabled={saving} value={draft.reps} onChange={(event) => setDraft({ ...draft, reps: event.target.value })} />次
          </label>
          {exercise?.weighted && (
            <label className="field-chip">
              <input className="wide" type="number" inputMode="decimal" min={0} step="any" placeholder="-" aria-label={`${name}重量（kg）`} disabled={saving} value={draft.weightKg} onChange={(event) => setDraft({ ...draft, weightKg: event.target.value })} />kg
            </label>
          )}
        </div>
      ) : (
        <div className="muted meal-foods">{actual ? '' : '计划 '}{values.sets} 组 × {values.reps} 次{exercise?.weighted && values.weightKg !== undefined ? ` · ${values.weightKg} kg` : ''}</div>
      )}
    </Row>
  );
}
