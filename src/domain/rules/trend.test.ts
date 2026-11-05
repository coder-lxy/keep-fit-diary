import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { analyzeTrend, isExcludedDay, movingAverage, type DailyPoint } from './trend';

function series(start: string, days: number, f: (i: number) => number, bf?: (i: number) => number): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(start, i),
    weightKg: f(i),
    bodyFatPct: bf?.(i),
  }));
}

const END = '2026-10-28';
const start = (days: number) => addDays(END, -(days - 1));

describe('trend', () => {
  it('不足 7 天：数据不足', () => {
    const r = analyzeTrend({ points: series(start(5), 5, () => 60), periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 1 });
    expect(r.state).toBe('insufficient');
  });
  it('每周稳定下降 0.5 kg：正常', () => {
    const pts = series(start(21), 21, (i) => 62 - i * (0.5 / 7));
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 1 });
    expect(r.state).toBe('normal');
    expect(r.weeklySpeedKg).toBeCloseTo(0.5, 1);
  });
  it('每周降 1.2 kg：过快，预算 +150', () => {
    const pts = series(start(21), 21, (i) => 65 - i * (1.2 / 7));
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 1 });
    expect(r.state).toBe('tooFast');
    expect(r.budgetDeltaKcal).toBe(150);
  });
  it('14 天不动且打卡率高：平台期', () => {
    const pts = series(start(21), 21, (i) => 60.5 + (i % 2) * 0.05);
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 0.9 });
    expect(r.state).toBe('plateau');
    expect(r.addStrengthSet).toBe(true);
  });
  it('14 天不动但打卡率低：不判平台期，归为过慢并提示补记录', () => {
    const pts = series(start(21), 21, (i) => 61 - i * 0.005);
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 0.4 });
    expect(r.state).toBe('tooSlow');
    expect(r.budgetDeltaKcal).toBe(0);
    expect(r.advices[0]).toContain('打卡率');
  });
  it('反弹', () => {
    const pts = series(start(21), 21, (i) => (i < 14 ? 60 : 60.6));
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 1 });
    expect(r.state).toBe('rebound');
  });
  it('经期及前 3 天排除', () => {
    const periods = [{ start: '2026-10-20', end: '2026-10-24' }];
    expect(isExcludedDay('2026-10-17', periods)).toBe(true);
    expect(isExcludedDay('2026-10-16', periods)).toBe(false);
    expect(isExcludedDay('2026-10-24', periods)).toBe(true);
    expect(isExcludedDay('2026-10-25', periods)).toBe(false);
    const pts = series('2026-10-15', 14, (i) => (i >= 5 && i <= 9 ? 70 : 60));
    // 经期刚结束时窗口内有效点不足 3 个，不出均值
    expect(movingAverage(pts, '2026-10-25', periods, (p) => p.weightKg)).toBeUndefined();
    // 10-25、26、27 三个有效点，经期的 70 kg 不参与
    expect(movingAverage(pts, '2026-10-27', periods, (p) => p.weightKg)).toBe(60);
  });
  it('掉肌肉：蛋白提高、缺口减 100', () => {
    const pts = series(start(28), 28, (i) => 62 - i * 0.07, (i) => 30 + i * 0.02);
    const r = analyzeTrend({ points: pts, periods: [], date: END, targetRateKg: 0.5, dietCheckinRate: 1 });
    expect(r.highProtein).toBe(true);
    expect(r.state).toBe('normal');
    expect(r.budgetDeltaKcal).toBe(100);
  });
});
