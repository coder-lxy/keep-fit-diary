import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Bar as RBar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, formatCn, today, weekStartOf, weekdayIndex } from '../domain/dates';
import { db } from '../domain/db';
import { avg7Series } from '../domain/rules/trend';
import { dailyPoints } from '../services/planService';
import { dayComplete, summarizeRange, type DaySummary } from '../services/stats';
import { r1 } from '../hooks';

const RANGES = [{ k: 30, l: '30 天' }, { k: 90, l: '90 天' }, { k: 180, l: '180 天' }, { k: 0, l: '全部' }];

export default function Trends() {
  const [range, setRange] = useState(30);
  const t = today();
  const from = range ? addDays(t, -(range - 1)) : '2000-01-01';
  const data = useLiveQuery(async () => {
    const pts = await dailyPoints();
    const periods = await db.periods.toArray();
    const profile = await db.profile.get(1);
    const avg = new Map(avg7Series(pts, periods).map((x) => [x.date, x.value]));
    const bfAvg = new Map(avg7Series(pts, periods, (p) => p.bodyFatPct).map((x) => [x.date, x.value]));
    const rows = pts.filter((p) => p.date >= from).map((p) => ({
      date: p.date, label: formatCn(p.date), weight: p.weightKg, avg7: avg.get(p.date),
      bf: p.bodyFatPct, bfAvg: bfAvg.get(p.date),
      fatKg: p.bodyFatPct ? Math.round(p.weightKg * p.bodyFatPct) / 100 : undefined,
      lbm: p.bodyFatPct ? Math.round(p.weightKg * (100 - p.bodyFatPct)) / 100 : undefined,
    }));
    const first = rows[0]?.date ?? from;
    return { rows, periods: periods.filter((p) => (p.end ?? t) >= first), target: profile?.targetWeightKg, targetBf: profile?.targetBodyFatPct };
  }, [from]);
  const kcal = useLiveQuery(async () => {
    const days = await summarizeRange(range ? from : addDays(t, -89), t);
    return days.filter((d) => d.plan || d.mealsLogged).map((d) => ({ label: formatCn(d.date), eaten: Math.round(d.eaten.kcal), budget: d.plan?.budgetKcal, burn: d.burnKcal }));
  }, [from]);
  const month = useLiveQuery(() => summarizeRange(addDays(t, -34), t), []);
  const weekly = useLiveQuery(async () => {
    const ws = weekStartOf(t);
    const thisWeek = await summarizeRange(ws, t);
    const lastWeek = await summarizeRange(addDays(ws, -7), addDays(ws, -1));
    return { thisWeek, lastWeek };
  }, []);

  return (
    <>
      <h1>趋势</h1>
      <div className="seg" style={{ marginBottom: 12 }}>
        {RANGES.map((r) => <button key={r.k} className={range === r.k ? 'on' : ''} onClick={() => setRange(r.k)}>{r.l}</button>)}
      </div>

      <div className="card">
        <h2>体重</h2>
        {data && data.rows.length > 1 ? (
          <div className="chart">
            <ResponsiveContainer>
              <ComposedChart data={data.rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(1) : v)} />
                {data.periods.map((p) => (
                  <ReferenceArea key={p.start} x1={formatCn(p.start)} x2={formatCn(p.end ?? t)} fill="var(--warn)" fillOpacity={0.12} />
                ))}
                {data.target && <ReferenceLine y={data.target} stroke="var(--accent)" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="weight" name="体重" stroke="var(--muted)" dot={{ r: 2 }} strokeWidth={1} isAnimationActive={false} />
                <Line type="monotone" dataKey="avg7" name="7 日均线" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="muted">记录两天以上开始画图。</p>}
        <p className="muted small">灰点是每日称重，绿线是 7 日均线（经期前后不计），淡橙底是经期，虚线是目标体重。</p>
      </div>

      <div className="card">
        <h2>体脂</h2>
        {data && data.rows.filter((r) => r.bf).length > 1 ? (
          <div className="chart">
            <ResponsiveContainer>
              <ComposedChart data={data.rows.filter((r) => r.bf)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis yAxisId="pct" domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="kg" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={34} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(1) : v)} />
                {data.targetBf && <ReferenceLine yAxisId="pct" y={data.targetBf} stroke="var(--accent)" strokeDasharray="4 4" />}
                <Line yAxisId="pct" type="monotone" dataKey="bfAvg" name="体脂率均线 %" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                <Line yAxisId="kg" type="monotone" dataKey="fatKg" name="脂肪 kg" stroke="var(--warn)" dot={false} isAnimationActive={false} />
                <Line yAxisId="kg" type="monotone" dataKey="lbm" name="去脂体重 kg" stroke="var(--muted)" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="muted">记录体脂率后显示。去脂体重掉得比脂肪快，说明在掉肌肉。</p>}
      </div>

      <div className="card">
        <h2>热量</h2>
        {kcal && kcal.length > 0 ? (
          <div className="chart">
            <ResponsiveContainer>
              <ComposedChart data={kcal} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <RBar dataKey="eaten" name="摄入" fill="var(--accent)" fillOpacity={0.7} isAnimationActive={false} />
                <Line type="step" dataKey="budget" name="预算" stroke="var(--warn)" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="burn" name="运动消耗" stroke="var(--muted)" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="muted">开始饮食打卡后显示。</p>}
      </div>

      {weekly && <WeeklyReport thisWeek={weekly.thisWeek} lastWeek={weekly.lastWeek} />}

      <div className="card">
        <h2>打卡日历</h2>
        {month && <Calendar days={month} />}
        <p className="muted small">左点饮食、右点运动，实心为完成；橙底为经期。</p>
      </div>
    </>
  );
}

function WeeklyReport({ thisWeek, lastWeek }: { thisWeek: DaySummary[]; lastWeek: DaySummary[] }) {
  const avgW = (d: DaySummary[]) => { const v = d.map((x) => x.weightKg).filter((x): x is number => !!x); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined; };
  const w1 = avgW(thisWeek), w0 = avgW(lastWeek);
  const planned = thisWeek.filter((d) => d.plan);
  const avgEaten = planned.length ? planned.reduce((s, d) => s + d.eaten.kcal, 0) / planned.filter((d) => d.mealsLogged).length || 0 : 0;
  const trainDays = thisWeek.filter((d) => d.plan && d.plan.dayType !== 'rest');
  const workoutRate = trainDays.length ? trainDays.filter((d) => d.workoutDone).length / trainDays.length : 0;
  const dietRate = planned.length ? planned.filter((d) => d.dietDone).length / planned.length : 0;
  let conclusion = '继续保持，数据够一周后这里会给结论。';
  if (w1 !== undefined && w0 !== undefined) {
    const diff = w0 - w1;
    conclusion = diff > 0.2 ? `本周平均体重比上周降了 ${r1(diff)} kg，方向对。` : diff < -0.2 ? `本周平均体重比上周高 ${r1(-diff)} kg，看看是不是经期或者摄入偏多。` : '本周平均体重和上周基本持平，看首页趋势解读的建议。';
  }
  return (
    <div className="card">
      <h2>本周周报</h2>
      <div className="grid3">
        <div className="stat"><div className="num">{w1 ? r1(w1) : '-'}</div><div className="lbl">平均体重 kg</div></div>
        <div className="stat"><div className="num">{w1 && w0 ? (w1 - w0 > 0 ? '+' : '') + r1(w1 - w0) : '-'}</div><div className="lbl">较上周 kg</div></div>
        <div className="stat"><div className="num">{avgEaten ? Math.round(avgEaten) : '-'}</div><div className="lbl">平均摄入 kcal</div></div>
        <div className="stat"><div className="num">{Math.round(workoutRate * 100)}%</div><div className="lbl">运动完成率</div></div>
        <div className="stat"><div className="num">{Math.round(dietRate * 100)}%</div><div className="lbl">饮食打卡率</div></div>
        <div className="stat"><div className="num">{thisWeek.filter(dayComplete).length}</div><div className="lbl">完整打卡天</div></div>
      </div>
      <p className="advice" style={{ marginTop: 10 }}>{conclusion}</p>
    </div>
  );
}

function Calendar({ days }: { days: DaySummary[] }) {
  const t = today();
  const lead = weekdayIndex(days[0].date);
  return (
    <div className="cal">
      {['一', '二', '三', '四', '五', '六', '日'].map((d) => <div key={d} className="muted small center">{d}</div>)}
      {Array.from({ length: lead }).map((_, i) => <div key={`x${i}`} />)}
      {days.map((d) => (
        <div key={d.date} className={`d ${d.isPeriod ? 'period' : ''} ${d.date === t ? 'today' : ''}`}>
          <span>{Number(d.date.slice(8))}</span>
          <div className="dots">
            <span className={`dot ${d.dietDone ? 'on' : ''}`} />
            <span className={`dot ${d.workoutDone && d.plan ? 'on' : ''}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
