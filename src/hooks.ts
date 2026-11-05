import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './domain/db';
import type { FoodItem, FoodPortion } from './domain/types';
import { UNIT_LABEL } from './domain/types';
import { nutritionOf } from './domain/rules/mealPlan';

export function useFoods(): FoodItem[] | undefined {
  return useLiveQuery(() => db.foods.toArray(), []);
}

export function useFoodsMap(): Map<number, FoodItem> {
  const foods = useFoods();
  return new Map((foods ?? []).map((f) => [f.id!, f]));
}

export function describePortion(p: FoodPortion, foods: Map<number, FoodItem>): { name: string; amount: string; kcal: number } {
  const f = foods.get(p.foodId);
  if (!f) return { name: '（已删除）', amount: '', kcal: 0 };
  return {
    name: f.name,
    amount: `${formatAmount(p.amount)} ${UNIT_LABEL[f.unit]}`,
    kcal: Math.round(nutritionOf(f, p.amount).kcal),
  };
}

export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function r1(n: number | undefined): string {
  return n === undefined ? '-' : (Math.round(n * 10) / 10).toFixed(1);
}
