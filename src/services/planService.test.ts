import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, nowIso, today } from '../domain/dates';
import { db, ensureSeeded, exportAll, importAll, importPresetFoods } from '../domain/db';
import { generatePlanForDate, logMealAsPlanned } from './planService';
import { setIngredientInStock } from './ingredients';
import { streak, summarizeRange } from './stats';

const T = today();

describe('planService 端到端', () => {
  beforeAll(async () => {
    await ensureSeeded();
    await importPresetFoods();
    await db.foods.toCollection().modify({ inStock: true });
    await db.profile.put({
      id: 1, sex: 'female', birthDate: '1995-06-01', heightCm: 165, activity: 'light',
      targetWeightKg: 55, weeklyRateKg: 0.5, cycleDays: 28, periodDays: 5, createdAt: nowIso(),
    });
    await db.settings.update(1, { onboarded: true });
    for (let i = 10; i >= 0; i--) {
      await db.bodyRecords.add({ date: addDays(T, -i), time: '07:00', weightKg: 62 - (10 - i) * 0.07, bodyFatPct: 30, source: 'manual', isDaily: true });
    }
  });

  it('预置数据写入', async () => {
    expect(await db.foods.count()).toBeGreaterThan(70);
    expect(await db.strengthExercises.count()).toBe(10);
    expect((await db.schedule.get(1))?.strengthDefault.length).toBeGreaterThan(0);
  });

  it('首次并发生成同一天的计划时，计划和运动记录各保留一条', async () => {
    await Promise.all([generatePlanForDate(T), generatePlanForDate(T)]);
    expect(await db.plans.where('date').equals(T).count()).toBe(1);
    expect(await db.workoutLogs.where('date').equals(T).count()).toBe(1);
  });

  it('生成今日计划：四餐、运动、预算，并写入 WorkoutLog', async () => {
    const plan = await generatePlanForDate(T);
    expect(plan.meals).toHaveLength(4);
    expect(plan.budgetKcal).toBeGreaterThan(1100);
    expect(plan.proteinG).toBeGreaterThan(80);
    expect(['cardio', 'strength', 'rest']).toContain(plan.dayType);
    const log = await db.workoutLogs.where('date').equals(T).first();
    expect(log?.dayType).toBe(plan.dayType);
    expect((await db.plans.where('date').equals(T).count())).toBe(1);
  });

  it('手动改日类型会重新生成并保留唯一计划', async () => {
    const plan = await generatePlanForDate(T, { manualDayType: 'strength' });
    expect(plan.dayType).toBe('strength');
    expect(plan.dayTypeSource).toBe('manual');
    expect(plan.strength?.length).toBeGreaterThan(0);
    expect(await db.plans.where('date').equals(T).count()).toBe(1);
  });

  it('手动换过类型后标记经期，重置日类型则按经期休息', async () => {
    await generatePlanForDate(T, { manualDayType: 'strength' });
    const id = await db.periods.add({ start: T, end: addDays(T, 4) });
    try {
      // 不重置时旧的手动指定仍然生效
      expect((await generatePlanForDate(T)).dayType).toBe('strength');
      const plan = await generatePlanForDate(T, { resetDayType: true });
      expect(plan.dayType).toBe('rest');
      expect(plan.dayTypeSource).toBe('period');
      const log = await db.workoutLogs.where('date').equals(T).first();
      expect(log?.dayType).toBe('rest');
      expect(log?.dayTypeSource).toBe('period');
      expect(log?.completed).toBe(true);
    } finally {
      await db.periods.delete(id);
      await generatePlanForDate(T, { manualDayType: 'strength' });
    }
  });

  it('运动记录保存失败时回滚计划，不留下只保存一半的数据', async () => {
    const plan = await db.plans.where('date').equals(T).first();
    const workout = await db.workoutLogs.where('date').equals(T).first();
    const saveWorkout = vi.spyOn(db.workoutLogs, 'put').mockRejectedValueOnce(new Error('存储暂不可用'));
    try {
      await expect(generatePlanForDate(T, { manualDayType: 'cardio' })).rejects.toThrow('存储暂不可用');
      expect(await db.plans.where('date').equals(T).first()).toEqual(plan);
      expect(await db.workoutLogs.where('date').equals(T).first()).toEqual(workout);
    } finally {
      saveWorkout.mockRestore();
    }
  });

  it('完成一餐 → MealLog，复合索引可查', async () => {
    const plan = (await db.plans.where('date').equals(T).first())!;
    await logMealAsPlanned(plan, 'breakfast');
    const log = await db.mealLogs.where('[date+slot]').equals([T, 'breakfast']).first();
    expect(log?.status).toBe('planned');
    expect(log?.items.length).toBeGreaterThan(0);
  });

  it('没有现有食材时从食物库补，添加后只用现有食材，跨周仍生效且保留打卡', async () => {
    const foods = await db.foods.toArray();
    const pick = (name: string) => foods.find((f) => f.name === name)!.id!;
    const ids = [pick('米饭'), pick('鸡胸肉（生）'), pick('西兰花'), pick('鸡蛋'), pick('燕麦片（干）'), pick('全脂牛奶'), pick('苹果')];
    const logged = await db.mealLogs.toArray();
    await db.foods.toCollection().modify({ inStock: false });
    let plan = await generatePlanForDate(T, { mealsOnly: true });
    expect(plan.meals.every((m) => m.items.length > 0)).toBe(true);
    expect(plan.meals.every((m) => m.warning === undefined)).toBe(true);
    for (const id of ids) await setIngredientInStock(id, true);
    plan = await generatePlanForDate(T, { mealsOnly: true });
    const used = new Set(plan.meals.flatMap((m) => m.items.map((i) => i.foodId)));
    for (const id of used) expect(ids).toContain(id);
    for (const slot of ['lunch', 'dinner']) {
      expect(plan.meals.find((m) => m.slot === slot)!.items.length).toBe(3);
    }
    expect(await db.mealLogs.toArray()).toEqual(logged);

    const nextWeek = await generatePlanForDate(addDays(T, 7));
    const nextWeekItems = nextWeek.meals.flatMap((meal) => meal.items);
    expect(nextWeekItems.length).toBeGreaterThan(0);
    expect(nextWeekItems.every((item) => ids.includes(item.foodId))).toBe(true);

    await setIngredientInStock(pick('米饭'), false);
    const updated = await generatePlanForDate(T, { mealsOnly: true });
    expect(updated.meals.flatMap((meal) => meal.items).some((item) => item.foodId === pick('米饭'))).toBe(false);
  });

  it('统计与备份', async () => {
    const days = await summarizeRange(addDays(T, -3), T);
    expect(days).toHaveLength(4);
    expect(days[3].plan).toBeTruthy();
    expect(await streak()).toBeGreaterThanOrEqual(0);
    const backup = await exportAll();
    expect(backup.tables.foods.length).toBeGreaterThan(70);
    await importAll(backup);
    expect(await db.plans.count()).toBe(2);
    expect((await db.settings.get(1))?.lastBackupAt).toBeTruthy();
  });
});
