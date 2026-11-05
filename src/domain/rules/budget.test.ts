import { describe, expect, it } from 'vitest';
import { bmrKatch, bmrMifflin, computeBudget, estimateWeeksToGoal } from './budget';

describe('budget', () => {
  it('Mifflin 女性公式', () => {
    expect(Math.round(bmrMifflin('female', 60, 165, 30))).toBe(1320);
  });
  it('Katch-McArdle 按去脂体重', () => {
    expect(Math.round(bmrKatch(60, 30))).toBe(1277);
  });
  it('0.5 kg/周 ≈ 550 kcal 缺口，训练日只加一半消耗', () => {
    const r = computeBudget({
      sex: 'female', age: 30, heightCm: 165, activity: 'moderate', weightKg: 60,
      weeklyRateKg: 0.5, isPeriod: false, plannedBurnKcal: 200,
    });
    expect(r.deficit).toBe(550);
    expect(r.tdee).toBe(2046);
    expect(r.budget).toBe(2046 - 550 + 100);
    expect(r.floorHit).toBe(false);
    expect(r.proteinG).toBe(96);
    expect(r.formula).toBe('mifflin');
  });
  it('轻度活动的女性 550 缺口会碰到 BMR×1.1 下限', () => {
    const r = computeBudget({
      sex: 'female', age: 30, heightCm: 165, activity: 'light', weightKg: 60,
      weeklyRateKg: 0.5, isPeriod: false, plannedBurnKcal: 0,
    });
    expect(r.floorHit).toBe(true);
    expect(r.budget).toBe(1452);
  });
  it('触发下限保护', () => {
    const r = computeBudget({
      sex: 'female', age: 45, heightCm: 155, activity: 'sedentary', weightKg: 50,
      weeklyRateKg: 0.75, isPeriod: false, plannedBurnKcal: 0,
    });
    expect(r.floorHit).toBe(true);
    expect(r.budget).toBeGreaterThanOrEqual(1200);
  });
  it('经期 +150，手动覆盖优先', () => {
    const base = computeBudget({
      sex: 'female', age: 30, heightCm: 165, activity: 'moderate', weightKg: 60,
      weeklyRateKg: 0.5, isPeriod: false, plannedBurnKcal: 0,
    });
    const period = computeBudget({
      sex: 'female', age: 30, heightCm: 165, activity: 'moderate', weightKg: 60,
      weeklyRateKg: 0.5, isPeriod: true, plannedBurnKcal: 0,
    });
    expect(period.budget - base.budget).toBe(150);
    const ov = computeBudget({
      sex: 'female', age: 30, heightCm: 165, activity: 'moderate', weightKg: 60,
      weeklyRateKg: 0.5, isPeriod: true, plannedBurnKcal: 0, overrideKcal: 1500,
    });
    expect(ov.budget).toBe(1500);
  });
  it('达标周数', () => {
    expect(estimateWeeksToGoal(60, 55, 0.5)).toBe(10);
    expect(estimateWeeksToGoal(60, 55, 0)).toBeNull();
    expect(estimateWeeksToGoal(54, 55, 0.5)).toBe(0);
  });
});
