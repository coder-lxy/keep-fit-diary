import { RULES } from '../constants';
import type { Activity, Sex } from '../types';

export interface BudgetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  activity: Activity;
  /** 7 日平均体重 */
  weightKg: number;
  bodyFatPct?: number;
  weeklyRateKg: number;
  isPeriod: boolean;
  /** 当日计划运动预计消耗 */
  plannedBurnKcal: number;
  /** 趋势规则给出的预算调整 */
  budgetDeltaKcal?: number;
  /** 掉肌肉时蛋白提高 */
  highProtein?: boolean;
  /** 用户手动覆盖 */
  overrideKcal?: number;
}

export interface BudgetResult {
  bmr: number;
  tdee: number;
  deficit: number;
  budget: number;
  floorHit: boolean;
  proteinG: number;
  fatG: number;
  carbsG: number;
  lbmKg?: number;
  formula: 'katch' | 'mifflin';
}

export function bmrKatch(weightKg: number, bodyFatPct: number): number {
  return 370 + 21.6 * weightKg * (1 - bodyFatPct / 100);
}

export function bmrMifflin(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

export function computeBudget(i: BudgetInput): BudgetResult {
  const hasBf = i.bodyFatPct !== undefined && i.bodyFatPct > 0;
  const lbm = hasBf ? i.weightKg * (1 - i.bodyFatPct! / 100) : undefined;
  const bmr = hasBf
    ? bmrKatch(i.weightKg, i.bodyFatPct!)
    : bmrMifflin(i.sex, i.weightKg, i.heightCm, i.age);
  const tdee = bmr * RULES.activityFactor[i.activity];
  const deficit = (i.weeklyRateKg * RULES.kcalPerKg) / 7;

  let budget = tdee - deficit;
  budget += i.plannedBurnKcal * RULES.trainingBurnCredit;
  if (i.isPeriod) budget += RULES.periodBonusKcal;
  budget += i.budgetDeltaKcal ?? 0;

  const floor = Math.max(bmr * RULES.floorBmrFactor, RULES.floorKcal[i.sex]);
  let floorHit = false;
  if (budget < floor) {
    budget = floor;
    floorHit = true;
  }
  if (i.overrideKcal && i.overrideKcal > 0) {
    budget = i.overrideKcal;
    floorHit = false;
  }

  const proteinG = lbm
    ? lbm * (i.highProtein ? RULES.proteinPerLbmHigh : RULES.proteinPerLbm)
    : i.weightKg * RULES.proteinPerKg;
  const fatG = Math.max(i.weightKg * RULES.fatPerKg, (budget * RULES.fatMinShare) / 9);
  const carbsG = Math.max(0, (budget - proteinG * 4 - fatG * 9) / 4);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    deficit: Math.round(deficit),
    budget: Math.round(budget),
    floorHit,
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
    lbmKg: lbm ? Math.round(lbm * 10) / 10 : undefined,
    formula: hasBf ? 'katch' : 'mifflin',
  };
}

/** 预计达标日期：剩余公斤 ÷ 周速度 */
export function estimateWeeksToGoal(
  currentKg: number,
  targetKg: number,
  weeklySpeedKg: number,
): number | null {
  const remain = currentKg - targetKg;
  if (remain <= 0) return 0;
  if (weeklySpeedKg <= 0) return null;
  return Math.ceil(remain / weeklySpeedKg);
}
