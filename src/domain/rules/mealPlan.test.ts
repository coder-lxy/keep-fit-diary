import { describe, expect, it } from 'vitest';
import { RULES } from '../constants';
import { PRESET_FOODS } from '../seed';
import type { FoodItem } from '../types';
import { generateMealPlan, nutritionOf, sumNutrition } from './mealPlan';

const foods: FoodItem[] = PRESET_FOODS.map((f, i) => ({ ...f, id: i + 1, autoPlan: true, useCount: 0, hidden: false }));
const byId = new Map(foods.map((f) => [f.id!, f]));
let seed = 42;
const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

describe('mealPlan', () => {
  it('营养换算', () => {
    const rice = foods.find((f) => f.name === '米饭')!;
    expect(nutritionOf(rice, 200).kcal).toBeCloseTo(232);
    const egg = foods.find((f) => f.name === '鸡蛋')!;
    expect(nutritionOf(egg, 2).protein).toBeCloseTo(12.6);
  });
  it('四餐热量接近预算、蛋白达标、克数取整到 5', () => {
    const plan = generateMealPlan({ budgetKcal: 1400, proteinG: 95, foods, split: { ...RULES.mealSplit }, rng });
    expect(plan).toHaveLength(4);
    const total = plan.reduce((s, m) => s + sumNutrition(m.items, byId).kcal, 0);
    expect(Math.abs(total - 1400) / 1400).toBeLessThan(0.12);
    const protein = plan.reduce((s, m) => s + sumNutrition(m.items, byId).protein, 0);
    expect(protein).toBeGreaterThan(80);
    for (const m of plan) for (const it of m.items) {
      const f = byId.get(it.foodId)!;
      if (f.unit === 'g' || f.unit === 'ml') expect(it.amount % 5).toBe(0);
      expect(it.amount).toBeLessThanOrEqual(f.defaultAmount * RULES.maxPortionMultiple + 5);
    }
  });
  it('现有食材没有蔬菜时留空并提示', () => {
    const noVeg = foods.filter((f) => f.category !== 'vegetable');
    const plan = generateMealPlan({ budgetKcal: 1400, proteinG: 95, foods: noVeg, split: { ...RULES.mealSplit }, rng });
    const lunch = plan.find((m) => m.slot === 'lunch')!;
    expect(lunch.warning).toContain('蔬菜');
    expect(lunch.items).toHaveLength(2);
  });
  it('现有食材没有蔬菜时从食物库补，其他类仍优先用现有食材', () => {
    const noVeg = foods.filter((f) => f.category !== 'vegetable');
    const plan = generateMealPlan({ budgetKcal: 1400, proteinG: 95, foods: noVeg, fallbackFoods: foods, split: { ...RULES.mealSplit }, rng });
    const lunch = plan.find((m) => m.slot === 'lunch')!;
    expect(lunch.warning).toBeUndefined();
    expect(lunch.items).toHaveLength(3);
    const cats = lunch.items.map((i) => byId.get(i.foodId)!.category);
    expect(cats).toContain('vegetable');
    const inStock = new Set(noVeg.map((f) => f.id));
    expect(lunch.items.filter((i) => byId.get(i.foodId)!.category !== 'vegetable').every((i) => inStock.has(i.foodId))).toBe(true);
  });
  it('只有少量现有食材时，午餐和晚餐可以重复使用，不会误报缺少', () => {
    const selected = foods.filter((food) => ['米饭', '鸡胸肉（生）', '西兰花'].includes(food.name));
    const plan = generateMealPlan({ budgetKcal: 1400, proteinG: 95, foods: selected, split: { ...RULES.mealSplit }, rng });
    for (const slot of ['lunch', 'dinner']) {
      const meal = plan.find((item) => item.slot === slot)!;
      expect(meal.items).toHaveLength(3);
      expect(meal.warning).toBeUndefined();
      expect(new Set(meal.items.map((item) => item.foodId))).toEqual(new Set(selected.map((food) => food.id)));
    }
  });
  it('避开昨天的蛋白来源', () => {
    const chicken = foods.find((f) => f.name === '鸡胸肉（生）')!;
    const onlyTwoProteins = foods.filter((f) => f.category !== 'protein' || f.name === '鸡胸肉（生）' || f.name === '虾');
    const plan = generateMealPlan({ budgetKcal: 1400, proteinG: 95, foods: onlyTwoProteins, split: { ...RULES.mealSplit }, yesterdayProteinIds: [chicken.id!], rng });
    const lunch = plan.find((m) => m.slot === 'lunch')!;
    expect(lunch.items.some((i) => i.foodId === chicken.id)).toBe(false);
  });
});
