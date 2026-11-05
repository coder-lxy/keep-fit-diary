import { useRef, useState } from 'react';
import { NumberInput } from '../components/ui';
import { nowIso, nowTime, today } from '../domain/dates';
import { db, importPresetFoods } from '../domain/db';
import type { Activity, Sex } from '../domain/types';

export default function Onboarding() {
  const [sex, setSex] = useState<Sex>('female');
  const [birth, setBirth] = useState('1995-01-01');
  const [height, setHeight] = useState<number | undefined>(165);
  const [activity, setActivity] = useState<Activity>('light');
  const [weight, setWeight] = useState<number | undefined>();
  const [bf, setBf] = useState<number | undefined>();
  const [targetW, setTargetW] = useState<number | undefined>();
  const [targetBf, setTargetBf] = useState<number | undefined>();
  const [rate, setRate] = useState<0.25 | 0.5 | 0.75>(0.5);
  const [cycle, setCycle] = useState<number | undefined>(28);
  const [period, setPeriod] = useState<number | undefined>(5);
  const [preset, setPreset] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    if (!height || !weight) return setErr('身高和当前体重必填');
    if (!targetW && !targetBf) return setErr('目标体重和目标体脂至少填一个');
    submitting.current = true;
    setSaving(true);
    setErr('');
    try {
      await db.transaction('rw', [db.profile, db.bodyRecords, db.foods, db.settings], async () => {
        await db.profile.put({
          id: 1, sex, birthDate: birth, heightCm: height, activity,
          targetWeightKg: targetW, targetBodyFatPct: targetBf, weeklyRateKg: rate,
          cycleDays: cycle ?? 28, periodDays: period ?? 5, createdAt: nowIso(),
        });
        await db.bodyRecords.add({ date: today(), time: nowTime(), weightKg: weight, bodyFatPct: bf, source: 'manual', isDaily: true });
        if (preset) await importPresetFoods();
        await db.settings.update(1, { onboarded: true });
      });
      // 由 App 在观察到 onboarded 更新后跳转，等待期间保持提交按钮禁用。
    } catch (e) {
      setErr(`保存失败：${e instanceof Error ? e.message : '请重试'}`);
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <h1>欢迎使用减脂日记</h1>
      <p className="muted">填一次档案，之后每天早晨称重，App 会给出当天的饮食和运动计划。</p>
      <div className="card">
        <label>性别</label>
        <div className="seg">
          <button className={sex === 'female' ? 'on' : ''} onClick={() => setSex('female')}>女</button>
          <button className={sex === 'male' ? 'on' : ''} onClick={() => setSex('male')}>男</button>
        </div>
        <label>出生日期</label>
        <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        <label>身高</label>
        <NumberInput value={height} onChange={setHeight} suffix="cm" />
        <label>日常活动水平（不含计划内运动）</label>
        <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
          <option value="sedentary">久坐（办公室，很少走动）</option>
          <option value="light">轻度（每天有些走动）</option>
          <option value="moderate">中度（体力活或站立为主）</option>
        </select>
      </div>
      <div className="card">
        <div className="grid2">
          <div><label>当前体重</label><NumberInput value={weight} onChange={setWeight} step={0.1} suffix="kg" /></div>
          <div><label>当前体脂率（选填）</label><NumberInput value={bf} onChange={setBf} step={0.1} suffix="%" /></div>
          <div><label>目标体重</label><NumberInput value={targetW} onChange={setTargetW} step={0.1} suffix="kg" /></div>
          <div><label>目标体脂率</label><NumberInput value={targetBf} onChange={setTargetBf} step={0.1} suffix="%" /></div>
        </div>
        <label>每周减重速度</label>
        <div className="seg">
          {([0.25, 0.5, 0.75] as const).map((r) => (
            <button key={r} className={rate === r ? 'on' : ''} onClick={() => setRate(r)}>{r} kg</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="grid2">
          <div><label>平均周期天数</label><NumberInput value={cycle} onChange={setCycle} suffix="天" /></div>
          <div><label>经期天数</label><NumberInput value={period} onChange={setPeriod} suffix="天" /></div>
        </div>
        <label className="row" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={preset} onChange={(e) => setPreset(e.target.checked)} />
          <span>导入约 80 种常见食材到食物库（之后可随时删改）</span>
        </label>
      </div>
      {err && <p className="notice">{err}</p>}
      <button className="primary block" disabled={saving} onClick={submit}>{saving ? '正在保存…' : '开始使用'}</button>
    </>
  );
}
