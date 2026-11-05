import { useLiveQuery } from 'dexie-react-hooks';
import { NumberInput, TopBar } from '../components/ui';
import { ageAt, today } from '../domain/dates';
import { db } from '../domain/db';
import { computeBudget, estimateWeeksToGoal } from '../domain/rules/budget';
import type { Activity, Sex, UserProfile } from '../domain/types';

export default function Profile() {
  const p = useLiveQuery(() => db.profile.get(1), []);
  const latest = useLiveQuery(async () => (await db.bodyRecords.toArray()).filter((r) => r.isDaily).sort((a, b) => b.date.localeCompare(a.date))[0], []);
  if (!p) return null;
  const save = (patch: Partial<UserProfile>) => db.profile.update(1, patch);
  const preview = latest
    ? computeBudget({ sex: p.sex, age: ageAt(p.birthDate, today()), heightCm: p.heightCm, activity: p.activity, weightKg: latest.weightKg, bodyFatPct: latest.bodyFatPct, weeklyRateKg: p.weeklyRateKg, isPeriod: false, plannedBurnKcal: 0, overrideKcal: p.budgetOverrideKcal })
    : undefined;
  const weeks = latest && p.targetWeightKg ? estimateWeeksToGoal(latest.weightKg, p.targetWeightKg, p.weeklyRateKg) : null;

  return (
    <>
      <TopBar title="档案与目标" />
      <div className="card">
        <label>性别</label>
        <div className="seg">
          <button className={p.sex === 'female' ? 'on' : ''} onClick={() => save({ sex: 'female' as Sex })}>女</button>
          <button className={p.sex === 'male' ? 'on' : ''} onClick={() => save({ sex: 'male' as Sex })}>男</button>
        </div>
        <label>出生日期</label>
        <input type="date" value={p.birthDate} onChange={(e) => save({ birthDate: e.target.value })} />
        <label>身高</label>
        <NumberInput value={p.heightCm} onChange={(v) => v && save({ heightCm: v })} suffix="cm" />
        <label>日常活动水平</label>
        <select value={p.activity} onChange={(e) => save({ activity: e.target.value as Activity })}>
          <option value="sedentary">久坐</option><option value="light">轻度</option><option value="moderate">中度</option>
        </select>
      </div>
      <div className="card">
        <div className="grid2">
          <div><label>目标体重</label><NumberInput value={p.targetWeightKg} onChange={(v) => save({ targetWeightKg: v })} step={0.1} suffix="kg" /></div>
          <div><label>目标体脂率</label><NumberInput value={p.targetBodyFatPct} onChange={(v) => save({ targetBodyFatPct: v })} step={0.1} suffix="%" /></div>
        </div>
        <label>每周减重速度</label>
        <div className="seg">
          {([0.25, 0.5, 0.75] as const).map((r) => <button key={r} className={p.weeklyRateKg === r ? 'on' : ''} onClick={() => save({ weeklyRateKg: r })}>{r} kg</button>)}
        </div>
        <label>手动覆盖每日热量预算（留空为自动）</label>
        <NumberInput value={p.budgetOverrideKcal} onChange={(v) => save({ budgetOverrideKcal: v })} suffix="kcal" />
        {p.budgetOverrideKcal && <button className="sm ghost" onClick={() => save({ budgetOverrideKcal: undefined })}>恢复自动</button>}
      </div>
      <div className="card">
        <div className="grid2">
          <div><label>平均周期天数</label><NumberInput value={p.cycleDays} onChange={(v) => v && save({ cycleDays: v })} suffix="天" /></div>
          <div><label>经期天数</label><NumberInput value={p.periodDays} onChange={(v) => v && save({ periodDays: v })} suffix="天" /></div>
        </div>
      </div>
      {preview && (
        <div className="card">
          <h3>按当前数据计算</h3>
          <div className="grid3">
            <div className="stat"><div className="num">{preview.bmr}</div><div className="lbl">基础代谢</div></div>
            <div className="stat"><div className="num">{preview.tdee}</div><div className="lbl">每日总消耗</div></div>
            <div className="stat"><div className="num">{preview.budget}</div><div className="lbl">休息日预算</div></div>
            <div className="stat"><div className="num">{preview.proteinG}</div><div className="lbl">蛋白 g</div></div>
            <div className="stat"><div className="num">{preview.fatG}</div><div className="lbl">脂肪 g</div></div>
            <div className="stat"><div className="num">{preview.carbsG}</div><div className="lbl">碳水 g</div></div>
          </div>
          <p className="muted small">{preview.formula === 'katch' ? '有体脂率，用 Katch-McArdle 公式' : '没有体脂率，用 Mifflin-St Jeor 公式'}{preview.floorHit ? '；预算已触及下限保护' : ''}。
            {weeks !== null && weeks !== undefined && (weeks === 0 ? ' 已达目标。' : ` 按目标速度约 ${weeks} 周达标。`)}</p>
        </div>
      )}
    </>
  );
}
