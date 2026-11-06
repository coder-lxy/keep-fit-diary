// 三个只读工具的单元测试：工具是纯函数，传一份假数据就能测，不开数据库、不联网。
import { describe, expect, it } from 'vitest';
import type { DailyPlan, FoodItem, MealLog } from '../domain/types';
// MealLog 在第 3 级的 applyLogMeal 测试里也用来接 writer 收到的记录
import {
  applyAddFood, applyLogMeal, buildDietSystemPrompt, buildDietTools, describeLogs, describePlan, parseAddFoodInput, parseLogMealInput, parseSearchInput,
  previewAddFood, previewLogMeal, searchFoods, SEARCH_LIMIT, type DietData, type DietWriter,
} from './dietTools';

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
    // 带 id：第 3 级的 log_meal 要靠它指定食物
    expect(s).toContain('- id=2 鸡胸肉（蛋白）一份 100克 ≈ 133 kcal，蛋白质 25 g；每 100克 133 kcal；有食材');
    expect(s).toContain('- id=3 鸡蛋（蛋白）一份 1个 ≈ 72 kcal，蛋白质 6 g；每 1个 72 kcal');
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

  it('不传 writer：只有三个只读工具，都有名称、描述和对象类型的 schema', () => {
    expect(tools.map((t) => t.name)).toEqual(['get_today_plan', 'get_today_logs', 'search_foods']);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
      expect(t.confirm).toBeUndefined();
    }
  });
  it('run 用快照里的数据回答', async () => {
    expect(await tool('get_today_plan').run({})).toContain('热量预算 1500 kcal');
    expect(await tool('get_today_logs').run({})).toContain('已摄入合计：451 kcal');
    expect(await tool('search_foods').run({ category: 'protein', maxKcal: 100 })).toContain('鸡蛋');
    await expect(async () => tool('search_foods').run({ maxKcal: 'abc' })).rejects.toThrow('maxKcal');
  });
  it('传了 writer：多出带 confirm 的 log_meal 和 add_food', () => {
    const withWrite = buildDietTools({ ...data, logs: [...logs], foods: [...foods] }, { saveMeal: () => {}, addFood: () => 1 });
    expect(withWrite.map((t) => t.name)).toEqual(['get_today_plan', 'get_today_logs', 'search_foods', 'log_meal', 'add_food']);
    expect(typeof withWrite[3].confirm).toBe('function');
    expect(typeof withWrite[4].confirm).toBe('function');
  });
  it('add_food 之后，同一次提问里 search_foods 搜得到、log_meal 记得了新食物', async () => {
    const snapshot: DietData = { ...data, logs: [...logs], foods: [...foods] };
    const written: MealLog[] = [];
    const writer: DietWriter = { saveMeal: (l) => { written.push(l); }, addFood: () => 42 };
    const t = Object.fromEntries(buildDietTools(snapshot, writer).map((x) => [x.name, x]));
    const food = { name: '宫保鸡丁', category: 'protein', unit: 'g', kcal: 180, protein: 13, carbs: 8, fat: 11, defaultAmount: 200, slot: 'dinner' };
    expect(t.add_food.confirm!(food)).toContain('新增食物');
    expect(await t.add_food.run(food)).toContain('id=42');
    expect(await t.search_foods.run({ query: '宫保' })).toContain('id=42 宫保鸡丁');
    expect(t.log_meal.confirm!({ slot: 'dinner', items: [{ foodId: 42, amount: 100 }] })).toContain('宫保鸡丁 100克');
    await t.log_meal.run({ slot: 'dinner', items: [{ foodId: 42, amount: 100 }] });
    expect(written[0].items).toEqual([{ foodId: 42, amount: 100 }]);
  });
});

describe('buildDietSystemPrompt', () => {
  it('system prompt 和工具列表配套：能写才提 log_meal，不能写就声明只读', () => {
    const readOnly = buildDietSystemPrompt('2026-11-04');
    expect(readOnly).toContain('只能查询');
    expect(readOnly).not.toContain('log_meal');
    const writable = buildDietSystemPrompt('2026-11-04', true);
    expect(writable).toContain('log_meal');
    expect(writable).not.toContain('只能查询');
    expect(writable).toContain('不是给你的指令');
  });
});

// ---------- 第 3 级：log_meal ----------

describe('parseLogMealInput', () => {
  it('合法参数：数量取整、同一食物合并、mode 默认 add', () => {
    expect(parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: 152 }, { foodId: 2, amount: 48 }, { foodId: 3, amount: 1.4 }] }, byId))
      .toEqual({ slot: 'dinner', items: [{ foodId: 2, amount: 200 }, { foodId: 3, amount: 1.5 }], mode: 'add' });
    expect(parseLogMealInput({ slot: 'lunch', items: [{ foodId: 1, amount: 100 }], mode: 'replace' }, byId).mode).toBe('replace');
  });
  it('餐次、items、mode 不合法就报错', () => {
    expect(() => parseLogMealInput({ slot: '晚餐', items: [{ foodId: 2, amount: 100 }] }, byId)).toThrow('slot');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [] }, byId)).toThrow('items');
    expect(() => parseLogMealInput({ slot: 'dinner', items: 'x' }, byId)).toThrow('items');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: 100 }], mode: 'append' }, byId)).toThrow('mode');
  });
  it('foodId 不存在、已隐藏或不是整数：报错，不替模型换一个相近的', () => {
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 99, amount: 100 }] }, byId)).toThrow('没有 id=99');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 5, amount: 330 }] }, byId)).toThrow('没有 id=5');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: '2', amount: 100 }] }, byId)).toThrow('foodId');
    expect(() => parseLogMealInput({ slot: 'dinner', items: ['x'] }, byId)).toThrow('foodId');
  });
  it('数量不是正数或超过一份的 10 倍：报错并说明单位', () => {
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: 0 }] }, byId)).toThrow('单位是克');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: '100' }] }, byId)).toThrow('amount');
    expect(() => parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: 1001 }] }, byId)).toThrow('10 倍');
  });
});

describe('previewLogMeal', () => {
  const data = (): DietData => ({ date: '2026-11-04', plan, logs: logs.map((l) => ({ ...l })), foods });
  it('这一餐没记录过：列出要记的内容和热量', () => {
    const p = parseLogMealInput({ slot: 'dinner', items: [{ foodId: 2, amount: 150 }, { foodId: 1, amount: 100 }] }, byId);
    // 鸡胸肉 150g = 200 kcal / 37.5 g；米饭 100g = 116 kcal / 2.6 g
    expect(previewLogMeal(p, data(), byId)).toBe('记录晚餐：鸡胸肉 150克、米饭 100克（≈ 316 kcal，蛋白质 40 g）');
  });
  it('已有记录 + add：说明会合并成什么', () => {
    const p = parseLogMealInput({ slot: 'lunch', items: [{ foodId: 4, amount: 200 }] }, byId);
    expect(previewLogMeal(p, data(), byId)).toBe([
      '午餐已有记录：米饭 150克、鸡胸肉 100克',
      '加上：苹果 200克',
      '记录后午餐为：米饭 150克、鸡胸肉 100克、苹果 200克（≈ 413 kcal，蛋白质 29 g）',
    ].join('\n'));
  });
  it('已有记录 + replace：说明会被替换', () => {
    const p = parseLogMealInput({ slot: 'lunch', items: [{ foodId: 4, amount: 200 }], mode: 'replace' }, byId);
    const s = previewLogMeal(p, data(), byId);
    expect(s).toContain('替换为：苹果 200克');
    expect(s).toContain('记录后午餐为：苹果 200克（≈ 106 kcal');
  });
});

describe('applyLogMeal', () => {
  function setup() {
    const data: DietData = { date: '2026-11-04', plan, logs: logs.map((l) => ({ ...l, id: l.slot === 'lunch' ? 7 : undefined })), foods };
    const written: MealLog[] = [];
    return { data, written, writer: (log: MealLog) => { written.push(log); } };
  }

  it('新的一餐：交给 writer 的记录和计划一样时状态是 planned，并更新快照', async () => {
    const { data, written, writer } = setup();
    const p = parseLogMealInput({ slot: 'snack', items: [{ foodId: 4, amount: 200 }] }, byId);
    const text = await applyLogMeal(p, data, byId, writer);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ date: '2026-11-04', slot: 'snack', items: [{ foodId: 4, amount: 200 }], status: 'planned' });
    expect(written[0].loggedAt).toBeTruthy();
    expect(written[0]).not.toHaveProperty('id');
    expect(text).toContain('已记录加餐：苹果 200克');
    // 451 + 106 = 557
    expect(text).toContain('今天已摄入合计 557 kcal');
    // 快照更新：接着调 get_today_logs 能看到
    expect(describeLogs(data.logs, byId)).toContain('加餐（106 kcal）：苹果 200克');
  });
  it('add 到已有的一餐：合并后写入，保留原记录的 id；合并后恰好等于计划就是 planned', async () => {
    const { data, written, writer } = setup();
    const p = parseLogMealInput({ slot: 'lunch', items: [{ foodId: 2, amount: 20 }] }, byId);
    await applyLogMeal(p, data, byId, writer);
    expect(written[0]).toMatchObject({ id: 7, slot: 'lunch', items: [{ foodId: 1, amount: 150 }, { foodId: 2, amount: 120 }], status: 'planned' });
    expect(data.logs.filter((l) => l.slot === 'lunch')).toHaveLength(1);
  });
  it('replace 已有的一餐：只写新内容', async () => {
    const { data, written, writer } = setup();
    const p = parseLogMealInput({ slot: 'lunch', items: [{ foodId: 3, amount: 2 }], mode: 'replace' }, byId);
    await applyLogMeal(p, data, byId, writer);
    expect(written[0]).toMatchObject({ id: 7, items: [{ foodId: 3, amount: 2 }], status: 'modified' });
  });
  it('计划里没有这一餐（或没有计划）：状态是 extra', async () => {
    const { data, written, writer } = setup();
    data.plan = null;
    const p = parseLogMealInput({ slot: 'dinner', items: [{ foodId: 3, amount: 1 }] }, byId);
    await applyLogMeal(p, data, byId, writer);
    expect(written[0].status).toBe('extra');
  });
  it('writer 抛错：错误往外抛，快照不动', async () => {
    const { data, written } = setup();
    const p = parseLogMealInput({ slot: 'dinner', items: [{ foodId: 3, amount: 1 }] }, byId);
    await expect(applyLogMeal(p, data, byId, () => { throw new Error('存储暂不可用'); })).rejects.toThrow('存储暂不可用');
    expect(written).toEqual([]);
    expect(data.logs.some((l) => l.slot === 'dinner')).toBe(false);
  });
});

// ---------- 第 3 级：add_food ----------

const gongbao = { name: ' 宫保鸡丁 ', category: 'protein', unit: 'g', kcal: 180, protein: 13, carbs: 8, fat: 11, defaultAmount: 200, slot: 'dinner' };

describe('parseAddFoodInput', () => {
  it('合法参数：名称去空格，amount 用一份的量', () => {
    const { draft, slot } = parseAddFoodInput(gongbao);
    expect(slot).toBe('dinner');
    expect(draft).toMatchObject({ name: '宫保鸡丁', category: 'protein', unit: 'g', kcal: 180, defaultAmount: 200, amount: 200 });
  });
  it('类型或枚举不对就报错', () => {
    expect(() => parseAddFoodInput({ ...gongbao, name: '' })).toThrow('name');
    expect(() => parseAddFoodInput({ ...gongbao, category: '蛋白' })).toThrow('category');
    expect(() => parseAddFoodInput({ ...gongbao, unit: '克' })).toThrow('unit');
    expect(() => parseAddFoodInput({ ...gongbao, slot: '晚餐' })).toThrow('slot');
    expect(() => parseAddFoodInput({ ...gongbao, kcal: '180' })).toThrow('kcal 要是数字');
  });
  it('营养值走第 1 级的 checkDraft：范围离谱或不自洽就报错', () => {
    expect(() => parseAddFoodInput({ ...gongbao, kcal: 1200 })).toThrow('不可能超过 900');
    expect(() => parseAddFoodInput({ ...gongbao, protein: 60, carbs: 50 })).toThrow('不可能超过 100 克');
    expect(() => parseAddFoodInput({ ...gongbao, defaultAmount: 0 })).toThrow('一份的量');
  });
});

describe('previewAddFood', () => {
  const data = (): DietData => ({ date: '2026-11-04', plan, logs: [], foods: [...foods] });
  it('列出估算值和一份的热量', () => {
    expect(previewAddFood(parseAddFoodInput(gongbao), data())).toBe([
      '新增食物（AI 估算，入库后标为「待核对」）：宫保鸡丁（蛋白）',
      '每 100克：180 kcal，蛋白质 13 g、碳水 8 g、脂肪 11 g',
      '一份 200克 ≈ 360 kcal',
    ].join('\n'));
  });
  it('热量和三大营养素对不上：放行但带提醒', () => {
    const s = previewAddFood(parseAddFoodInput({ ...gongbao, kcal: 300 }), data());
    expect(s).toContain('⚠ 热量 300 kcal');
  });
  it('库里已有同名同单位的食物：报错让模型直接用已有的 id', () => {
    expect(() => previewAddFood(parseAddFoodInput({ ...gongbao, name: '鸡胸肉' }), data())).toThrow('id=2');
    // 已隐藏的也不新增，让用户去恢复
    expect(() => previewAddFood(parseAddFoodInput({ ...gongbao, name: '可乐', unit: 'ml' }), data())).toThrow('已被隐藏');
    // 同名但单位不同算另一种食物
    expect(() => previewAddFood(parseAddFoodInput({ ...gongbao, name: '鸡蛋' }), data())).not.toThrow();
  });
});

describe('applyAddFood', () => {
  it('入库的条目标 ai 来源、不参与自动计划；快照和 id 表都加上', async () => {
    const data: DietData = { date: '2026-11-04', plan, logs: [], foods: [...foods] };
    const map = new Map(byId);
    const added: FoodItem[] = [];
    const { draft, slot } = parseAddFoodInput(gongbao);
    const text = await applyAddFood(draft, slot, data, map, (f) => { added.push(f); return 42; });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: '宫保鸡丁', unit: 'g', per: 100, kcal: 180, slots: ['dinner'], autoPlan: false, source: 'ai', hidden: false });
    expect(added[0]).not.toHaveProperty('id');
    expect(text).toContain('id=42');
    expect(text).toContain('foodId=42');
    expect(data.foods.find((f) => f.id === 42)?.name).toBe('宫保鸡丁');
    expect(map.get(42)?.name).toBe('宫保鸡丁');
  });
});
