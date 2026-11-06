import { RULES } from '../domain/constants';
import { addDays, ageAt, diffDays, nowIso, weekStartOf } from '../domain/dates';
import { db } from '../domain/db';
import { computeBudget } from '../domain/rules/budget';
import { cardioKcal } from '../domain/rules/exercise';
import { generateMealPlan, sumNutrition } from '../domain/rules/mealPlan';
import { decideDayType } from '../domain/rules/schedule';
import { analyzeTrend, isPeriodDay, movingAverage, type DailyPoint } from '../domain/rules/trend';
import type { DailyPlan, DayType, FoodItem, MealLog, MealSlot, PlannedMeal, WorkoutLog } from '../domain/types';
import { availableIngredients } from './ingredients';

export interface GenerateOptions {
  manualDayType?: DayType;
  /** 只重抽饮食，保留运动和预算 */
  mealsOnly?: boolean;
  /** 忽略之前手动指定的日类型，让规则（含经期休息）重新决定 */
  resetDayType?: boolean;
}

export async function dailyPoints(): Promise<DailyPoint[]> {
  const list = (await db.bodyRecords.toArray()).filter((r) => r.isDaily);
  return list
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, weightKg: r.weightKg, bodyFatPct: r.bodyFatPct }));
}

/** 最近 14 天（不含当天）里有饮食记录的天数占比；刚开始用时按实际天数算 */
export async function dietCheckinRate(date: string, firstDate?: string): Promise<number> {
  const from = addDays(date, -14);
  const logs = await db.mealLogs.where('date').between(from, date, true, false).toArray();
  const days = new Set(logs.map((l) => l.date)).size;
  let denom = 14;
  if (firstDate && firstDate > from) denom = Math.max(1, Math.min(14, diffDays(date, firstDate)));
  return Math.min(1, days / denom);
}

export async function generatePlanForDate(date: string, opts: GenerateOptions = {}): Promise<DailyPlan> {
  const profile = await db.profile.get(1);
  if (!profile) throw new Error('还没有建立档案');
  const settings = (await db.settings.get(1))!;
  const schedule = (await db.schedule.get(1))!;
  const periods = await db.periods.toArray();
  const points = await dailyPoints();
  const existing = await db.plans.where('date').equals(date).first();

  if (opts.mealsOnly && existing) {
    const foodsAll = await db.foods.toArray();
    const meals = await buildMeals(date, existing.budgetKcal, existing.proteinG, foodsAll, settings.mealSplit, false);
    const plan = { ...existing, meals, generatedAt: nowIso() };
    await db.plans.put(plan);
    return plan;
  }

  // 体重基准
  const todayRec = points.find((p) => p.date === date);
  const latest = [...points].reverse().find((p) => p.date <= date) ?? todayRec;
  const basisWeight = todayRec?.weightKg ?? latest?.weightKg;
  if (!basisWeight) throw new Error('还没有体重记录');
  const avgWeight = movingAverage(points, date, periods, (p) => p.weightKg) ?? basisWeight;
  const bodyFat =
    movingAverage(points, date, periods, (p) => p.bodyFatPct) ??
    [...points].reverse().find((p) => p.date <= date && p.bodyFatPct)?.bodyFatPct;

  const isPeriod = isPeriodDay(date, periods);
  const rate = await dietCheckinRate(date, points[0]?.date);
  const trend = analyzeTrend({ points, periods, date, targetRateKg: profile.weeklyRateKg, dietCheckinRate: rate });

  // 排期
  const ws = weekStartOf(date);
  const weekLogs = await db.workoutLogs.where('date').between(ws, date, true, false).toArray();
  const weekTypes: Record<string, DayType> = {};
  for (const l of weekLogs) weekTypes[l.date] = l.dayType;
  const periodDays = new Set<string>();
  for (let d = ws; d < date; d = addDays(d, 1)) if (isPeriodDay(d, periods)) periodDays.add(d);
  const existingLog = await db.workoutLogs.where('date').equals(date).first();
  const keepManual = !opts.resetDayType && existingLog?.dayTypeSource === 'manual';
  const manual = opts.manualDayType ?? (keepManual ? existingLog!.dayType : undefined);
  const decided = decideDayType({
    date, schedule, weekTypes, periodDays, isPeriodToday: isPeriod, manualOverride: manual,
    trendState: trend.state, muscleLoss: trend.bodyFat?.muscleLoss ?? false,
  });

  // 运动内容
  const types = await db.exerciseTypes.toArray();
  let cardio: DailyPlan['cardio'];
  let strength: DailyPlan['strength'];
  let plannedBurn = 0;
  if (decided.dayType === 'cardio') {
    const t = types.find((x) => x.id === schedule.cardioDefault.exerciseTypeId) ?? types[0];
    const minutes = Math.min(RULES.cardioExtraMax, schedule.cardioDefault.minutes + trend.cardioExtraMin);
    const kcal = cardioKcal(t?.met ?? 4.3, avgWeight, minutes);
    cardio = { exerciseTypeId: t?.id ?? 0, minutes, kcal };
    plannedBurn = kcal;
  } else if (decided.dayType === 'strength') {
    strength = schedule.strengthDefault.map((s) => ({ ...s, sets: s.sets + (trend.addStrengthSet ? 1 : 0) }));
    plannedBurn = cardioKcal(RULES.strengthMet, avgWeight, 30);
  }

  // 昨日复盘
  const advices = [...trend.advices];
  const yesterday = addDays(date, -1);
  const yPlan = await db.plans.where('date').equals(yesterday).first();
  const foodsAll = await db.foods.toArray();
  const foodsById = new Map(foodsAll.map((f) => [f.id!, f]));
  if (yPlan) {
    const yLogs = await db.mealLogs.where('date').equals(yesterday).toArray();
    const eaten = sumNutrition(yLogs.flatMap((l) => l.items), foodsById).kcal;
    if (yLogs.length && eaten > yPlan.budgetKcal * (1 + RULES.overBudgetRatio)) {
      advices.push(`昨天摄入 ${Math.round(eaten)} kcal，超预算 ${Math.round(((eaten - yPlan.budgetKcal) / yPlan.budgetKcal) * 100)}%，今天预算不变，照计划吃就好。`);
    }
    const yLog = await db.workoutLogs.where('date').equals(yesterday).first();
    if (yPlan.dayType !== 'rest' && !(yLog?.completed)) advices.push('昨天的训练没有打卡，今天的内容不叠加，按今天的来。');
  }
  let boostProtein = false;
  {
    let low = 0;
    for (let k = 1; k <= RULES.lowProteinDays; k++) {
      const d = addDays(date, -k);
      const p = await db.plans.where('date').equals(d).first();
      const logs = await db.mealLogs.where('date').equals(d).toArray();
      if (!p || !logs.length) break;
      if (sumNutrition(logs.flatMap((l) => l.items), foodsById).protein < p.proteinG * RULES.lowProteinRatio) low++;
    }
    if (low >= RULES.lowProteinDays) {
      boostProtein = true;
      advices.push('蛋白质连续 3 天不足目标的 80%，今天的计划加大了蛋白类份量。');
    }
  }

  const budget = computeBudget({
    sex: profile.sex, age: ageAt(profile.birthDate, date), heightCm: profile.heightCm,
    activity: profile.activity, weightKg: avgWeight, bodyFatPct: bodyFat,
    weeklyRateKg: profile.weeklyRateKg, isPeriod, plannedBurnKcal: plannedBurn,
    budgetDeltaKcal: trend.budgetDeltaKcal, highProtein: trend.highProtein,
    overrideKcal: profile.budgetOverrideKcal,
  });
  if (budget.floorHit) advices.push(`热量预算触到下限（基础代谢 × 1.1），按 ${budget.budget} kcal 执行，不再往下压。`);
  if (isPeriod) advices.push('经期内预算 +150 kcal，运动休息，这几天体重不参与速度考核。');

  const meals = await buildMeals(date, budget.budget, budget.proteinG, foodsAll, settings.mealSplit, boostProtein);
  const essentials = (await db.essentials.toArray()).filter((e) => e.enabled && e.dayTypes.includes(decided.dayType));

  const plan: DailyPlan = {
    id: existing?.id,
    date,
    budgetKcal: budget.budget,
    proteinG: budget.proteinG,
    fatG: budget.fatG,
    carbsG: budget.carbsG,
    trendState: trend.state,
    trendText: trend.text,
    advices,
    dayType: decided.dayType,
    dayTypeSource: decided.source,
    dayTypeReason: decided.reason,
    cardio,
    strength,
    essentialIds: essentials.sort((a, b) => a.order - b.order).map((e) => e.id!),
    meals,
    generatedAt: nowIso(),
    basisWeightKg: basisWeight,
  };
  // 生成期间可能切换页面或再次发起生成；在同一事务里读取最新主键并保存，
  // 避免两个首次生成请求同时插入同一天，也避免计划与运动记录只保存了一半。
  await db.transaction('rw', [db.plans, db.workoutLogs], async () => {
    const currentPlan = await db.plans.where('date').equals(date).first();
    plan.id = await db.plans.put({ ...plan, id: currentPlan?.id });

    const currentLog = await db.workoutLogs.where('date').equals(date).first();
    const log: WorkoutLog = currentLog ?? {
      date, dayType: decided.dayType, dayTypeSource: decided.source,
      essentialsDone: [], strengthDone: [], completed: false, backfilled: false,
    };
    if (decided.dayType === 'rest') log.completed = true;
    else if (log.dayType !== decided.dayType) log.completed = false;
    log.dayType = decided.dayType;
    log.dayTypeSource = decided.source;
    await db.workoutLogs.put(log);
  });
  return plan;
}

async function buildMeals(
  date: string,
  budgetKcal: number,
  proteinG: number,
  foodsAll: FoodItem[],
  split: Record<MealSlot, number>,
  boostProtein: boolean,
): Promise<PlannedMeal[]> {
  const yPlan = await db.plans.where('date').equals(addDays(date, -1)).first();
  const foodsById = new Map(foodsAll.map((f) => [f.id!, f]));
  const yesterdayProteinIds = yPlan
    ? yPlan.meals.flatMap((m) => m.items.map((i) => i.foodId)).filter((id) => foodsById.get(id)?.category === 'protein')
    : [];
  // 优先用现有食材，缺哪类就从食物库里补
  const foods = availableIngredients(foodsAll);
  const fallbackFoods = foodsAll.filter((f) => !f.hidden);
  return generateMealPlan({ budgetKcal, proteinG, foods, fallbackFoods, split, yesterdayProteinIds, boostProtein });
}

/** 按计划完成一餐，保存为实际饮食记录。 */
export async function logMealAsPlanned(plan: DailyPlan, slot: PlannedMeal['slot']): Promise<void> {
  const meal = plan.meals.find((m) => m.slot === slot);
  if (!meal) return;
  await saveMealLog({ date: plan.date, slot, items: meal.items, status: 'planned', loggedAt: nowIso() });
}

/**
 * 保存一餐的实际记录：同一天同一餐只有一条，已有就覆盖；并记一次食物使用。
 * 第 3 级的 AI 写工具 log_meal 也走这里，AI 没有别的路能碰到数据库。
 */
export async function saveMealLog(log: MealLog): Promise<void> {
  const existing = await db.mealLogs.where('[date+slot]').equals([log.date, log.slot]).first();
  await db.mealLogs.put({ ...log, id: existing?.id ?? log.id });
  await bumpUse(log.items.map((i) => i.foodId));
}

export async function bumpUse(foodIds: number[]): Promise<void> {
  for (const id of new Set(foodIds)) {
    const f = await db.foods.get(id);
    if (f) await db.foods.update(id, { useCount: f.useCount + 1 });
  }
}
