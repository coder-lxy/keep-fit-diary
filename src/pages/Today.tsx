import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, NumberInput } from '../components/ui';
import WorkoutCard from '../components/WorkoutCard';
import { RULES } from '../domain/constants';
import { addDays, formatCn, nowTime, today, WEEKDAY_CN, weekdayIndex } from '../domain/dates';
import { db } from '../domain/db';
import { sumNutrition } from '../domain/rules/mealPlan';
import { movingAverage } from '../domain/rules/trend';
import { SLOTS, SLOT_LABEL, type MealSlot } from '../domain/types';
import { describePortion, r1, useFoodsMap } from '../hooks';
import { getApiKey } from '../services/aiMeal';
import { dailyPoints, generatePlanForDate, logMealAsPlanned } from '../services/planService';
import { daysSince, streak } from '../services/stats';

export default function Today() {
  const date = today();
  const nav = useNavigate();
  const foods = useFoodsMap();
  // 注意：useLiveQuery 加载中是 undefined，查无结果时统一转成 null
  const plan = useLiveQuery(async () => (await db.plans.where('date').equals(date).first()) ?? null, [date]);
  const weigh = useLiveQuery(async () => (await db.bodyRecords.where('date').equals(date).toArray()).find((r) => r.isDaily) ?? null, [date]);
  const logs = useLiveQuery(() => db.mealLogs.where('date').equals(date).toArray(), [date]) ?? [];
  const workout = useLiveQuery(() => db.workoutLogs.where('date').equals(date).first(), [date]);
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const profile = useLiveQuery(() => db.profile.get(1), []);
  const streakDays = useLiveQuery(() => streak(), [logs.length, workout?.completed]);
  const stats = useLiveQuery(async () => {
    const pts = await dailyPoints();
    const periods = await db.periods.toArray();
    const y = pts.filter((p) => p.date < date).at(-1);
    const avg = movingAverage(pts, addDays(date, -1), periods, (p) => p.weightKg);
    return { yesterday: y, avg7: avg };
  }, [weigh?.id]);

  const [w, setW] = useState<number | undefined>();
  const [bf, setBf] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 数据库订阅可能在保存完成前刷新，用同步锁避免再次生成同一天的计划。
  const submitting = useRef(false);
  useEffect(() => {
    if (stats?.yesterday && w === undefined) {
      setW(stats.yesterday.weightKg);
      setBf(stats.yesterday.bodyFatPct);
    }
  }, [stats, w]);

  const regenerate = useCallback(async (mealsOnly = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await generatePlanForDate(date, { mealsOnly });
    } catch (e) {
      setError(`计划生成失败：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [date]);

  // 已称重但还没有计划：自动生成；失败后等待用户主动重试。
  useEffect(() => {
    if (weigh && plan === null && !error) void regenerate();
  }, [weigh, plan, error, regenerate]);

  async function saveWeight() {
    if (!w || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    let recorded = false;
    try {
      await db.bodyRecords.add({ date, time: nowTime(), weightKg: w, bodyFatPct: bf, source: 'manual', isDaily: true });
      recorded = true;
      await generatePlanForDate(date);
    } catch (e) {
      setError(`${recorded ? '体重已保存，计划生成失败' : '体重保存失败'}：${e instanceof Error ? e.message : '请重试'}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const eaten = sumNutrition(logs.flatMap((l) => l.items), foods);
  const logBySlot = new Map(logs.map((l) => [l.slot, l]));
  const backupDays = daysSince(settings?.lastBackupAt);
  const needBackup = backupDays === undefined || backupDays >= RULES.backupReminderDays;
  const mealsDone = SLOTS.filter((slot) => logBySlot.has(slot)).length;
  const remainingKcal = plan ? Math.round(plan.budgetKcal - eaten.kcal) : 0;

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">{formatCn(date)} · 周{WEEKDAY_CN[weekdayIndex(date)]}</p><h1>今日</h1></div>
        {(streakDays ?? 0) > 0 && <span className="pill">连续 {streakDays} 天</span>}
      </div>

      {/* 称重 */}
      <div className="card">
        <div className="card-head"><h2>晨间称重</h2><Link to="/history" className="small">历史记录</Link></div>
        {weigh ? (
          <div className="grid3">
            <div className="stat"><div className="num">{r1(weigh.weightKg)}</div><div className="lbl">体重 kg</div></div>
            <div className="stat"><div className="num">{weigh.bodyFatPct ? r1(weigh.bodyFatPct) : '-'}</div><div className="lbl">体脂率 %</div></div>
            <div className="stat">
              <div className="num">{stats?.yesterday ? signed(weigh.weightKg - stats.yesterday.weightKg) : '-'}</div>
              <div className="lbl">较昨日 kg</div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid2">
              <div><label>体重</label><NumberInput value={w} onChange={setW} step={0.1} suffix="kg" /></div>
              <div><label>体脂率（选填）</label><NumberInput value={bf} onChange={setBf} step={0.1} suffix="%" /></div>
            </div>
            <p className="hint">默认带入上次体重，体脂率可不填。</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary grow" disabled={busy || !w} onClick={saveWeight}>记录体重</button>
              <button className="ghost" disabled={busy || !!plan} onClick={() => regenerate()}>跳过称重</button>
            </div>
          </>
        )}
        {weigh && stats?.avg7 && (
          <p className="muted small">7 日均重 {r1(stats.avg7)} kg{profile?.targetWeightKg ? `，距目标还有 ${r1(Math.max(0, weigh.weightKg - profile.targetWeightKg))} kg` : ''}</p>
        )}
      </div>

      {error && (
        <div className="card" role="alert">
          <p className="notice">{error}</p>
          {weigh && <button className="ghost" disabled={busy} onClick={() => regenerate()}>重新生成计划</button>}
        </div>
      )}

      {!plan && (
        <div className="card dim">
          <h2>今日计划</h2>
          <p className="muted">{busy ? '正在生成今日计划…' : weigh ? '体重已记录，可以重新生成今日计划。' : '先称重，计划会在称重后自动生成。'}</p>
        </div>
      )}

      {plan && (
        <>
          {/* 热量 */}
          <div className="card">
            <div className="nutrition-heading">
              <div><p className="eyebrow">今日摄入</p><span className="nutrition-total">{Math.round(eaten.kcal)} <small>/ {plan.budgetKcal} kcal</small></span></div>
              <div className={`nutrition-remaining${remainingKcal < 0 ? ' over' : ''}`}>{remainingKcal < 0 ? '已超出' : '还可摄入'}<strong>{Math.abs(remainingKcal)} <small>kcal</small></strong></div>
            </div>
            <Bar value={eaten.kcal} max={plan.budgetKcal} />
            <div className="nutrition-macros">
              <div><span>蛋白质</span><strong>{Math.round(eaten.protein)} <small>/ {plan.proteinG} g</small></strong></div>
              <div><span>碳水</span><strong>{Math.round(eaten.carbs)} <small>/ {plan.carbsG} g</small></strong></div>
              <div><span>脂肪</span><strong>{Math.round(eaten.fat)} <small>/ {plan.fatG} g</small></strong></div>
            </div>
          </div>

          {/* 饮食计划 */}
          <div className="card">
            <div className="card-head">
              <div className="row"><h2>饮食</h2><span className="muted small">{mealsDone} / {SLOTS.length} 已记录</span></div>
              <button className="sm ghost" disabled={busy} onClick={() => regenerate(true)}>换一换</button>
            </div>
            {SLOTS.map((slot) => <MealRow key={slot} slot={slot} />)}
            {/* 没填 API Key 时不显示 AI 入口 */}
            {getApiKey() && <button className="block ghost" style={{ marginTop: 10 }} onClick={() => nav('/ask')}>问问 AI：还能吃什么 / 帮我记一餐</button>}
          </div>

          {/* 运动 */}
          {workout && <WorkoutCard plan={plan} log={workout} />}
          <details className="card disclosure">
            <summary><h2>趋势与建议</h2><span className={['normal', 'insufficient'].includes(plan.trendState) ? 'muted small' : 'pill warn'}>{plan.trendState === 'insufficient' ? '数据不足' : trendLabel(plan.trendState)}{plan.advices.length > 0 ? ` · ${plan.advices.length} 条建议` : ''}</span></summary>
            <div className="disclosure-body">
              <p>{plan.trendText}</p>
              {plan.advices.map((advice, index) => <p key={index}>{advice}</p>)}
            </div>
          </details>
        </>
      )}
      {needBackup && <Link to="/me/data" className="backup-reminder"><span>{backupDays === undefined ? '还未备份，建议导出一份数据' : `${backupDays} 天未备份`}</span><span>去备份 ›</span></Link>}
    </>
  );

  function MealRow({ slot }: { slot: MealSlot }) {
    const meal = plan!.meals.find((m) => m.slot === slot);
    const log = logBySlot.get(slot);
    const items = log ? log.items : meal?.items ?? [];
    const kcal = Math.round(sumNutrition(items, foods).kcal);
    return (
      <div className="meal-row">
        <div className="meal-details">
          <div className="meal-title">
            <strong>{log && <span aria-label="已记录" style={{ color: 'var(--accent)' }}>✓ </span>}{SLOT_LABEL[slot]}</strong>
            <span className="meal-kcal">{log ? '' : '约 '}{kcal} kcal</span>
          </div>
          <div className="muted meal-foods">
            {items.length === 0 && '（空）'}
            {items.map((it) => { const d = describePortion(it, foods); return <span key={it.foodId}>{d.name} {d.amount}</span>; })}
          </div>
          {meal?.warning && !log && <div className="meal-warning">{meal.warning}</div>}
        </div>
        <div className="meal-actions">
          <button className="sm ghost" onClick={() => nav(`/meal/${date}/${slot}`)}>修改</button>
          {!log && meal && meal.items.length > 0 && (
            <button className="sm primary" onClick={() => logMealAsPlanned(plan!, slot)}>完成</button>
          )}
          {log && <button className="sm ghost" onClick={() => db.mealLogs.delete(log.id!)}>撤销</button>}
        </div>
      </div>
    );
  }
}

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function trendLabel(s: string): string {
  return ({ normal: '正常', tooFast: '过快', tooSlow: '过慢', plateau: '平台期', rebound: '反弹' } as Record<string, string>)[s] ?? s;
}
