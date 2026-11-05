import { addDays, diffDays, today } from '../domain/dates';
import { db } from '../domain/db';
import { sumNutrition, type Nutrition } from '../domain/rules/mealPlan';
import { isPeriodDay } from '../domain/rules/trend';
import type { DailyPlan, FoodItem, MealLog, WorkoutLog } from '../domain/types';

export interface DaySummary {
  date: string;
  weightKg?: number;
  bodyFatPct?: number;
  plan?: DailyPlan;
  eaten: Nutrition;
  mealsLogged: number;
  dietDone: boolean;
  workout?: WorkoutLog;
  workoutDone: boolean;
  isPeriod: boolean;
  burnKcal: number;
}

export function dietComplete(logs: MealLog[]): boolean {
  const slots = new Set(logs.map((l) => l.slot));
  return slots.has('breakfast') && slots.has('lunch') && slots.has('dinner');
}

export async function summarizeRange(from: string, to: string): Promise<DaySummary[]> {
  const foods = new Map((await db.foods.toArray()).map((f) => [f.id!, f] as [number, FoodItem]));
  const [plans, logs, workouts, bodies, periods] = await Promise.all([
    db.plans.where('date').between(from, to, true, true).toArray(),
    db.mealLogs.where('date').between(from, to, true, true).toArray(),
    db.workoutLogs.where('date').between(from, to, true, true).toArray(),
    db.bodyRecords.where('date').between(from, to, true, true).toArray(),
    db.periods.toArray(),
  ]);
  const out: DaySummary[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dayLogs = logs.filter((l) => l.date === d);
    const plan = plans.find((p) => p.date === d);
    const w = workouts.find((x) => x.date === d);
    const b = bodies.find((x) => x.date === d && x.isDaily);
    const burn = w?.cardio?.kcal ?? 0;
    out.push({
      date: d,
      weightKg: b?.weightKg,
      bodyFatPct: b?.bodyFatPct,
      plan,
      eaten: sumNutrition(dayLogs.flatMap((l) => l.items), foods),
      mealsLogged: dayLogs.length,
      dietDone: dietComplete(dayLogs),
      workout: w,
      workoutDone: w ? w.completed : false,
      isPeriod: isPeriodDay(d, periods),
      burnKcal: burn,
    });
  }
  return out;
}

export function dayComplete(s: DaySummary): boolean {
  return s.dietDone && (s.workoutDone || !s.plan || s.plan.dayType === 'rest');
}

/** 连续打卡天数：从今天（若今天已完成）或昨天往前数 */
export async function streak(): Promise<number> {
  const t = today();
  const days = await summarizeRange(addDays(t, -120), t);
  let n = 0;
  let i = days.length - 1;
  if (!dayComplete(days[i])) i--;
  for (; i >= 0; i--) {
    if (dayComplete(days[i])) n++;
    else break;
  }
  return n;
}

export function toCsv(rows: DaySummary[]): string {
  const head = ['日期', '体重kg', '体脂率%', '摄入kcal', '蛋白g', '碳水g', '脂肪g', '热量预算', '运动类型', '运动消耗', '运动完成', '饮食完成', '经期'];
  const lines = rows.map((r) =>
    [
      r.date,
      r.weightKg ?? '',
      r.bodyFatPct ?? '',
      Math.round(r.eaten.kcal),
      Math.round(r.eaten.protein),
      Math.round(r.eaten.carbs),
      Math.round(r.eaten.fat),
      r.plan?.budgetKcal ?? '',
      r.plan?.dayType ?? '',
      r.burnKcal,
      r.workoutDone ? 1 : 0,
      r.dietDone ? 1 : 0,
      r.isPeriod ? 1 : 0,
    ].join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
}

export function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  return diffDays(today(), iso.slice(0, 10));
}
