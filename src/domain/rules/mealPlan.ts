import { RULES } from '../constants';
import type { FoodCategory, FoodItem, FoodPortion, MealSlot, PlannedMeal } from '../types';
import { SLOTS } from '../types';

export interface MealPlanInput {
  budgetKcal: number;
  proteinG: number;
  /** 候选食物（已按现有食材过滤） */
  foods: FoodItem[];
  /** 现有食材里没有某类时从这里补（整个食物库），不传就只用现有食材 */
  fallbackFoods?: FoodItem[];
  split: Record<MealSlot, number>;
  /** 昨天用过的蛋白食物 id，尽量避开 */
  yesterdayProteinIds?: number[];
  /** 蛋白连续偏低时优先加蛋白 */
  boostProtein?: boolean;
  /** 可注入的随机函数，便于测试 */
  rng?: () => number;
}

export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_NUTRITION: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** 食物按数量换算营养 */
export function nutritionOf(food: FoodItem, amount: number): Nutrition {
  const k = amount / food.per;
  return {
    kcal: food.kcal * k,
    protein: food.protein * k,
    carbs: food.carbs * k,
    fat: food.fat * k,
  };
}

export function sumNutrition(items: FoodPortion[], foods: Map<number, FoodItem>): Nutrition {
  return items.reduce<Nutrition>((acc, it) => {
    const f = foods.get(it.foodId);
    if (!f) return acc;
    const n = nutritionOf(f, it.amount);
    return {
      kcal: acc.kcal + n.kcal,
      protein: acc.protein + n.protein,
      carbs: acc.carbs + n.carbs,
      fat: acc.fat + n.fat,
    };
  }, EMPTY_NUTRITION);
}

/** 每餐结构模板 */
const STRUCTURE: Record<MealSlot, FoodCategory[][]> = {
  breakfast: [['staple'], ['protein'], ['dairy', 'fruit']],
  lunch: [['staple'], ['protein'], ['vegetable']],
  dinner: [['staple'], ['protein'], ['vegetable']],
  snack: [['fruit', 'dairy', 'snack']],
};

const CATEGORY_CN: Record<FoodCategory, string> = {
  staple: '主食',
  protein: '蛋白',
  vegetable: '蔬菜',
  fruit: '水果',
  dairy: '奶制',
  snack: '零食',
  drink: '饮品',
  other: '其他',
};

function weightedPick<T>(
  items: T[],
  weight: (t: T) => number,
  rng: () => number,
): T | undefined {
  if (items.length === 0) return undefined;
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function roundAmount(food: FoodItem, amount: number): number {
  if (food.unit === 'g' || food.unit === 'ml') {
    return Math.max(RULES.portionStepG, Math.round(amount / RULES.portionStepG) * RULES.portionStepG);
  }
  return Math.max(0.5, Math.round(amount * 2) / 2);
}

export function pickCandidates(
  foods: FoodItem[],
  slot: MealSlot,
  categories: FoodCategory[],
  exclude: Set<number>,
): FoodItem[] {
  return foods.filter(
    (f) =>
      f.autoPlan &&
      !f.hidden &&
      f.slots.includes(slot) &&
      categories.includes(f.category) &&
      !exclude.has(f.id!),
  );
}

/** 份量求解：等比例缩放主食和蛋白，让热量落在目标 ±5%，蛋白不低于分配量 */
export function solvePortions(
  picked: { food: FoodItem; amount: number }[],
  targetKcal: number,
  targetProtein: number,
): { food: FoodItem; amount: number }[] {
  const items = picked.map((p) => ({ ...p }));
  const scalable = items.filter((p) => p.food.category === 'staple' || p.food.category === 'protein');
  const total = () => items.reduce((s, p) => s + nutritionOf(p.food, p.amount).kcal, 0);
  const protein = () => items.reduce((s, p) => s + nutritionOf(p.food, p.amount).protein, 0);

  // 先按热量缩放
  for (let iter = 0; iter < 6; iter++) {
    const t = total();
    if (t === 0 || Math.abs(t - targetKcal) / targetKcal <= RULES.mealTolerance) break;
    const scalableKcal = scalable.reduce((s, p) => s + nutritionOf(p.food, p.amount).kcal, 0);
    if (scalableKcal === 0) break;
    const fixedKcal = t - scalableKcal;
    const ratio = Math.max(0.3, (targetKcal - fixedKcal) / scalableKcal);
    for (const p of scalable) {
      p.amount = Math.min(p.food.defaultAmount * RULES.maxPortionMultiple, p.amount * ratio);
    }
  }
  // 蛋白不够：优先加蛋白类
  const proteinItems = items.filter((p) => p.food.category === 'protein');
  for (let iter = 0; iter < 4 && protein() < targetProtein && proteinItems.length > 0; iter++) {
    for (const p of proteinItems) {
      p.amount = Math.min(p.food.defaultAmount * RULES.maxPortionMultiple, p.amount * 1.2);
    }
  }
  for (const p of items) p.amount = roundAmount(p.food, p.amount);
  return items;
}

export function generateMeal(
  slot: MealSlot,
  input: MealPlanInput,
  exclude: Set<number>,
): PlannedMeal {
  const rng = input.rng ?? Math.random;
  const targetKcal = input.budgetKcal * input.split[slot];
  const targetProtein = input.proteinG * input.split[slot];
  const missing: string[] = [];
  const picked: { food: FoodItem; amount: number }[] = [];
  const yesterday = new Set(input.yesterdayProteinIds ?? []);

  for (const cats of STRUCTURE[slot]) {
    // 优先用现有食材，现有食材里没有这一类时再从食物库里补
    let cands: FoodItem[] = [];
    for (const pool of foodPools(input)) {
      cands = pickCandidates(pool, slot, cats, exclude);
      // 食材少时允许跨餐重复使用，不能把「今天已经选过」误判为没有食材。
      if (cands.length === 0) cands = pickCandidates(pool, slot, cats, new Set(picked.map((item) => item.food.id!)));
      if (cands.length) break;
    }
    if (cats.includes('protein')) {
      const fresh = cands.filter((f) => !yesterday.has(f.id!));
      if (fresh.length > 0) cands = fresh;
    }
    const food = weightedPick(cands, (f) => 1 + Math.log1p(f.useCount), rng);
    if (!food) {
      missing.push(cats.map((c) => CATEGORY_CN[c]).join('或'));
      continue;
    }
    picked.push({ food, amount: food.defaultAmount });
  }

  const solved = solvePortions(picked, targetKcal, input.boostProtein ? targetProtein * 1.15 : targetProtein);
  return {
    slot,
    targetKcal: Math.round(targetKcal),
    items: solved.map((p) => ({ foodId: p.food.id!, amount: p.amount })),
    warning: missing.length ? `${input.fallbackFoods ? '食物库' : '现有食材'}里没有${missing.join('、')}` : undefined,
  };
}

function foodPools(input: MealPlanInput): FoodItem[][] {
  return input.fallbackFoods ? [input.foods, input.fallbackFoods] : [input.foods];
}

export function generateMealPlan(input: MealPlanInput): PlannedMeal[] {
  const used = new Set<number>();
  const meals: PlannedMeal[] = [];
  for (const slot of SLOTS) {
    const meal = generateMeal(slot, input, used);
    for (const it of meal.items) used.add(it.foodId);
    meals.push(meal);
  }
  return meals;
}

/** 单项替换：同分类内换一个 */
export function swapItem(
  meal: PlannedMeal,
  foodId: number,
  input: MealPlanInput,
  foodsById: Map<number, FoodItem>,
): PlannedMeal {
  const rng = input.rng ?? Math.random;
  const old = foodsById.get(foodId);
  if (!old) return meal;
  const exclude = new Set(meal.items.map((i) => i.foodId));
  const cands = foodPools(input).map((pool) => pickCandidates(pool, meal.slot, [old.category], exclude)).find((c) => c.length) ?? [];
  const next = weightedPick(cands, (f) => 1 + Math.log1p(f.useCount), rng);
  if (!next) return { ...meal, warning: `${input.fallbackFoods ? '食物库' : '现有食材'}里没有其他${CATEGORY_CN[old.category]}可换` };
  const picked = meal.items.map((it) => {
    const f = it.foodId === foodId ? next : foodsById.get(it.foodId)!;
    return { food: f, amount: it.foodId === foodId ? next.defaultAmount : it.amount };
  });
  const solved = solvePortions(picked, meal.targetKcal, input.proteinG * input.split[meal.slot]);
  return { ...meal, warning: undefined, items: solved.map((p) => ({ foodId: p.food.id!, amount: p.amount })) };
}
