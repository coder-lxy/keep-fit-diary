// 三个只读工具的单元测试：工具是纯函数，传一份假数据就能测，不开数据库、不联网。
import { describe, expect, it } from 'vitest';
import type { DailyPlan, FoodItem, MealLog } from '../domain/types';
import { buildDietTools, describeLogs, describePlan, parseSearchInput, searchFoods, SEARCH_LIMIT, type DietData } from './dietTools';

function food(id: number, name: string, category: FoodItem['category'], kcal: number, protein: number, extra: Partial<FoodItem> = {}): FoodItem {
  const unit = extra.unit ?? 'g';
  return {
    id, name, category, unit, per: unit === 'g' || unit === 'ml' ? 100 : 1,
    kcal, protein, carbs: 0, fat: 0, defaultAmount: unit === 'g' ? 100 : 1,
    slots: ['lunch', 'dinner'], autoPlan: true, useCount: 0, hidden: false, ...extra,
  };
}

const rice = food(1, '米饭', 'staple', 116, 2.6, { defaultAmount: 150 });
const chicken = food(2, '鸡胸肉', 'protein', 133, 25, { inStock: true, useCount: 5 });
const egg = food(3, '鸡蛋', 'protein', 72, 6.3, { unit: 'piece', slots: ['breakfast', 'lunch', 'dinner'] });
const apple = food(4, '苹果', 'fruit', 53, 0.2, { defaultAmount: 200, slots: ['snack'] });
const cola = food(5, '可乐', 'drink', 43, 0, { hidden: true, unit: 'ml', defaultAmount: 330 });
const foods = [rice, chicken, egg, apple, cola];
const byId = new Map(foods.map((f) => [f.id!, f]));

const plan: DailyPlan = {
  date: '2026-11-04', budgetKcal: 1500, proteinG: 110, fatG: 45, carbsG: 160,
  trendState: 'normal', trendText: '每周下降 0.6 kg。', advices: ['照计划吃就好。'],
  dayType: 'strength', dayTypeSource: 'auto', dayTypeReason: '', essentialIds: [],
  meals: [
    { slot: 'breakfast', targetKcal: 375, items: [{ foodId: 3, amount: 2 }] },
    { slot: 'lunch', targetKcal: 525, items: [{ foodId: 1, amount: 150 }, { foodId: 2, amount: 120 }] },
    { slot: 'dinner', targetKcal: 450, items: [] },
    { slot: 'snack', targetKcal: 150, items: [{ foodId: 4, amount: 200 }] },
  ],
  generatedAt: '', basisWeightKg: 60,
};
const logs: MealLog[] = [
  { date: '2026-11-04', slot: 'breakfast', items: [{ foodId: 3, amount: 2 }], status: 'planned', loggedAt: '' },
  { date: '2026-11-04', slot: 'lunch', items: [{ foodId: 1, amount: 150 }, { foodId: 2, amount: 100 }], status: 'modified', loggedAt: '' },
];

describe('describePlan', () => {
  it('没有计划时说明原因', () => {
    expect(describePlan(null, byId)).toContain('还没有生成计划');
  });
  it('列出预算、目标、趋势和每餐计划', () => {
    const s = describePlan(plan, byId);
    expect(s).toContain('热量预算 1500 kcal');
    expect(s).toContain('蛋白质 110 g');
    expect(s).toContain('力量日');
    expect(s).toContain('正常。每周下降 0.6 kg。');
    expect(s).toContain('照计划吃就好');
    expect(s).toContain('午餐（目标 525 kcal，计划约 334 kcal）：米饭 150克、鸡胸肉 120克');
    expect(s).toContain('晚餐（目标 450 kcal，计划约 0 kcal）：（空）');
  });
});

describe('describeLogs', () => {
  it('没有记录时说明已摄入 0', () => {
    expect(describeLogs([], byId)).toContain('已摄入 0 kcal');
  });
  it('汇总每餐和全天，列出没记录的餐次', () => {
    const s = describeLogs(logs, byId);
    expect(s).toContain('已记录 2 餐');
    expect(s).toContain('早餐（144 kcal）：鸡蛋 2个');
    expect(s).toContain('午餐（307 kcal）：米饭 150克、鸡胸肉 100克');
    expect(s).toContain('还没记录：晚餐、加餐');
    // 144 + 174 + 133 = 451；蛋白 12.6 + 3.9 + 25 = 41.5
    expect(s).toContain('已摄入合计：451 kcal，蛋白质 42 g');
  });
});

describe('parseSearchInput', () => {
  it('合法参数原样通过，空字符串当作没填', () => {
    expect(parseSearchInput({ query: ' 鸡 ', category: 'protein', slot: 'dinner', maxKcal: 200, inStockOnly: true }))
      .toEqual({ query: '鸡', category: 'protein', slot: 'dinner', maxKcal: 200, inStockOnly: true });
    expect(parseSearchInput({ query: '  ' })).toEqual({});
  });
  it('类型或取值不对就报错，不替模型猜', () => {
    expect(() => parseSearchInput({ maxKcal: '200' })).toThrow('maxKcal');
    expect(() => parseSearchInput({ maxKcal: -1 })).toThrow('maxKcal');
    expect(() => parseSearchInput({ category: '蛋白' })).toThrow('category');
    expect(() => parseSearchInput({ slot: 'supper' })).toThrow('slot');
    expect(() => parseSearchInput({ inStockOnly: 'yes' })).toThrow('inStockOnly');
  });
});

describe('searchFoods', () => {
  it('不传条件：列出全部未隐藏的食物，有食材的排前面', () => {
    const s = searchFoods(foods, {});
    expect(s).not.toContain('可乐');
    expect(s.indexOf('鸡胸肉')).toBeLessThan(s.indexOf('米饭'));
    expect(s).toContain('鸡胸肉（蛋白）一份 100克 ≈ 133 kcal，蛋白质 25 g；每 100克 133 kcal；有食材');
    expect(s).toContain('鸡蛋（蛋白）一份 1个 ≈ 72 kcal，蛋白质 6 g；每 1个 72 kcal');
  });
  it('按关键词、分类、餐次、热量上限、有无食材筛选', () => {
    expect(searchFoods(foods, { query: '鸡' })).toMatch(/鸡胸肉[\s\S]*鸡蛋/);
    expect(searchFoods(foods, { query: '鸡' })).not.toContain('米饭');
    expect(searchFoods(foods, { category: 'fruit' })).toContain('苹果');
    expect(searchFoods(foods, { slot: 'snack' })).not.toContain('米饭');
    expect(searchFoods(foods, { slot: 'breakfast' })).toContain('鸡蛋');
    // 一份热量：米饭 174、鸡胸肉 133、鸡蛋 72、苹果 106
    expect(searchFoods(foods, { maxKcal: 110 })).not.toContain('米饭');
    expect(searchFoods(foods, { maxKcal: 110 })).toContain('苹果');
    expect(searchFoods(foods, { inStockOnly: true })).toBe(searchFoods([chicken], {}));
  });
  it('没有结果时提示放宽条件', () => {
    expect(searchFoods(foods, { query: '牛排' })).toContain('没有符合条件的食物');
  });
  it('结果超过上限只显示前几条，并提示加条件', () => {
    const many = Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) => food(100 + i, `食物${i}`, 'other', 50, 1));
    const s = searchFoods(many, {});
    expect(s.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(SEARCH_LIMIT);
    expect(s).toContain(`共 ${SEARCH_LIMIT + 5} 种，只显示前 ${SEARCH_LIMIT} 种`);
  });
});

describe('buildDietTools', () => {
  const data: DietData = { date: '2026-11-04', plan, logs, foods };
  const tools = buildDietTools(data);
  const tool = (name: string) => tools.find((t) => t.name === name)!;

  it('三个工具都有名称、描述和对象类型的 schema', () => {
    expect(tools.map((t) => t.name)).toEqual(['get_today_plan', 'get_today_logs', 'search_foods']);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
    }
  });
  it('run 用快照里的数据回答', async () => {
    expect(await tool('get_today_plan').run({})).toContain('热量预算 1500 kcal');
    expect(await tool('get_today_logs').run({})).toContain('已摄入合计：451 kcal');
    expect(await tool('search_foods').run({ category: 'protein', maxKcal: 100 })).toContain('鸡蛋');
    await expect(async () => tool('search_foods').run({ maxKcal: 'abc' })).rejects.toThrow('maxKcal');
  });
});
