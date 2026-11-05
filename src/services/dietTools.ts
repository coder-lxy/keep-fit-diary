// 第 2 级的三个只读工具：查今天的计划、查今天吃了什么、搜食物库。
// 只读不写，Agent 怎么调都不会弄坏数据，适合第一次完整走 Agent 循环。
//
// 写工具时最花心思的是「描述」：它是写给模型看的说明书，决定模型会不会在对的时候、用对的参数调用它。
// 另一个要点是「先汇总再返回」：工具把原始记录整理成模型需要的几行话，而不是把整张表丢给它。
import { db } from '../domain/db';
import { nutritionOf, sumNutrition } from '../domain/rules/mealPlan';
import {
  CATEGORY_LABEL, DAY_TYPE_LABEL, SLOTS, SLOT_LABEL, TREND_LABEL, UNIT_LABEL,
  type DailyPlan, type FoodCategory, type FoodItem, type FoodPortion, type MealLog, type MealSlot,
} from '../domain/types';
import type { AgentTool } from './aiAgent';

/** 工具要用到的数据。提问前一次性从数据库读出来，工具本身就是纯函数，可以不联网、不开数据库测试 */
export interface DietData {
  date: string;
  plan: DailyPlan | null;
  logs: MealLog[];
  foods: FoodItem[];
}

export async function loadDietData(date: string): Promise<DietData> {
  const [plan, logs, foods] = await Promise.all([
    db.plans.where('date').equals(date).first(),
    db.mealLogs.where('date').equals(date).toArray(),
    db.foods.toArray(),
  ]);
  return { date, plan: plan ?? null, logs, foods };
}

const CATEGORIES = Object.keys(CATEGORY_LABEL) as FoodCategory[];
/** search_foods 最多返回这么多条：结果太长既费 token，模型也挑不过来 */
export const SEARCH_LIMIT = 15;

export function buildDietSystemPrompt(date: string): string {
  return [
    `你是减脂日记应用里的饮食助手。今天是 ${date}。用户会问今天饮食相关的问题，最常见的是「今天还能吃什么」。`,
    '',
    '你有三个只读工具可以查用户自己的数据：',
    '- get_today_plan：今天的热量预算、三大营养素目标和计划餐单',
    '- get_today_logs：今天已经记录吃了什么、已摄入多少',
    '- search_foods：按条件搜索用户的食物库',
    '',
    '规则：',
    '- 预算、已摄入量、食物营养值一律用工具查，不要凭印象猜。',
    '- 回答「还能吃什么」这类问题：先查计划和记录，算出剩余热量和蛋白质缺口，再用 search_foods 找合适的食物。',
    '- 推荐的食物只能来自 search_foods 的结果，给出具体数量和大致热量，总热量不超过剩余预算；蛋白质没达标时优先推荐蛋白类；标了「有食材」的优先。',
    '- 今天没有计划或没有记录时如实说明，再给出能给的建议。',
    '- 你只能查询，不能记录或修改任何数据。不要说「已帮你记录」之类的话。',
    '- 用中文回答，先一句话给结论，再列出具体建议，不要长篇大论。',
  ].join('\n');
}

export function buildDietTools(data: DietData): AgentTool[] {
  const foodsById = new Map(data.foods.map((f) => [f.id!, f]));
  return [
    {
      name: 'get_today_plan',
      description:
        '查询用户今天的饮食计划：热量预算（kcal）、蛋白质/脂肪/碳水目标（g）、训练日类型、体重趋势和建议，以及每餐的计划餐单。' +
        '凡是涉及「预算」「目标」「还能吃多少」「计划吃什么」的问题，先调用它。不含实际吃了什么，实际摄入用 get_today_logs 查。',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => describePlan(data.plan, foodsById),
    },
    {
      name: 'get_today_logs',
      description:
        '查询用户今天已经记录的饮食：每一餐吃了什么、多少热量，以及全天已摄入的热量和蛋白质/碳水/脂肪合计，还有哪几餐没记录。' +
        '回答「吃了多少」「还能吃多少」「蛋白质够不够」时调用。它只返回已吃的量，预算和目标要用 get_today_plan 查。',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => describeLogs(data.logs, foodsById),
    },
    {
      name: 'search_foods',
      description:
        '在用户的食物库里搜索食物，返回每种食物一份的量和对应的热量、蛋白质，并标出用户手边有的食材。' +
        '需要推荐具体吃什么时调用。可以按名称关键词、分类、适合的餐次、一份的最高热量来筛选；条件都可以不填，但结果最多显示 15 条，' +
        '结果太多时请加条件缩小范围（比如按分类或餐次）。推荐只能从返回的结果里选。',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '名称关键词，模糊匹配，如「鸡」「酸奶」' },
          category: { type: 'string', enum: CATEGORIES, description: `分类：${CATEGORIES.map((c) => `${c}=${CATEGORY_LABEL[c]}`).join('，')}` },
          slot: { type: 'string', enum: SLOTS, description: '适合的餐次：breakfast=早餐，lunch=午餐，dinner=晚餐，snack=加餐' },
          maxKcal: { type: 'number', description: '只要一份热量不超过这个数（kcal）的食物' },
          inStockOnly: { type: 'boolean', description: '只看用户手边有的食材，默认 false' },
        },
        additionalProperties: false,
      },
      run: (input) => searchFoods(data.foods, parseSearchInput(input)),
    },
  ];
}

// ---------- 工具实现：纯函数，便于测试 ----------

export function describePlan(plan: DailyPlan | null, foodsById: Map<number, FoodItem>): string {
  if (!plan) return '今天还没有生成计划（通常是因为还没有晨间称重）。没有预算可查，只能按一般原则建议。';
  const lines = [
    `日期：${plan.date}，${DAY_TYPE_LABEL[plan.dayType]}`,
    `热量预算 ${plan.budgetKcal} kcal；目标：蛋白质 ${plan.proteinG} g、脂肪 ${plan.fatG} g、碳水 ${plan.carbsG} g`,
    `体重趋势：${TREND_LABEL[plan.trendState]}。${plan.trendText}`,
  ];
  if (plan.advices.length) lines.push(`今日建议：${plan.advices.join(' ')}`);
  lines.push('计划餐单（计划不等于实际吃了，实际记录用 get_today_logs 查）：');
  for (const m of plan.meals) {
    const kcal = Math.round(sumNutrition(m.items, foodsById).kcal);
    lines.push(`- ${SLOT_LABEL[m.slot]}（目标 ${m.targetKcal} kcal，计划约 ${kcal} kcal）：${portionsText(m.items, foodsById)}`);
  }
  return lines.join('\n');
}

export function describeLogs(logs: MealLog[], foodsById: Map<number, FoodItem>): string {
  const logged = SLOTS.filter((s) => logs.some((l) => l.slot === s));
  const missing = SLOTS.filter((s) => !logged.includes(s));
  if (!logs.length) return '今天还没有记录任何一餐，已摄入 0 kcal。没记录不代表没吃，必要时提醒用户先记录。';
  const lines = [`今天已记录 ${logged.length} 餐：`];
  for (const slot of logged) {
    const items = logs.filter((l) => l.slot === slot).flatMap((l) => l.items);
    lines.push(`- ${SLOT_LABEL[slot]}（${Math.round(sumNutrition(items, foodsById).kcal)} kcal）：${portionsText(items, foodsById)}`);
  }
  lines.push(`还没记录：${missing.length ? missing.map((s) => SLOT_LABEL[s]).join('、') : '无'}`);
  const t = sumNutrition(logs.flatMap((l) => l.items), foodsById);
  lines.push(`已摄入合计：${Math.round(t.kcal)} kcal，蛋白质 ${Math.round(t.protein)} g、碳水 ${Math.round(t.carbs)} g、脂肪 ${Math.round(t.fat)} g`);
  return lines.join('\n');
}

export interface SearchInput {
  query?: string;
  category?: FoodCategory;
  slot?: MealSlot;
  maxKcal?: number;
  inStockOnly?: boolean;
}

/**
 * 模型给的参数是不可信输入：类型不对就报错，错误会以 is_error 回传，模型一般会改正后再调。
 * 这里不替模型猜（比如把 "100kcal" 当成 100），猜错了比报错更难发现。
 */
export function parseSearchInput(input: Record<string, unknown>): SearchInput {
  const out: SearchInput = {};
  const { query, category, slot, maxKcal, inStockOnly } = input;
  if (query !== undefined) {
    if (typeof query !== 'string') throw new Error('query 要是字符串');
    if (query.trim()) out.query = query.trim();
  }
  if (category !== undefined) {
    if (!CATEGORIES.includes(category as FoodCategory)) throw new Error(`category 只能是：${CATEGORIES.join('、')}`);
    out.category = category as FoodCategory;
  }
  if (slot !== undefined) {
    if (!SLOTS.includes(slot as MealSlot)) throw new Error(`slot 只能是：${SLOTS.join('、')}`);
    out.slot = slot as MealSlot;
  }
  if (maxKcal !== undefined) {
    if (typeof maxKcal !== 'number' || !Number.isFinite(maxKcal) || maxKcal <= 0) throw new Error('maxKcal 要是大于 0 的数字');
    out.maxKcal = maxKcal;
  }
  if (inStockOnly !== undefined) {
    if (typeof inStockOnly !== 'boolean') throw new Error('inStockOnly 要是 true 或 false');
    out.inStockOnly = inStockOnly;
  }
  return out;
}

export function searchFoods(foods: FoodItem[], q: SearchInput): string {
  const hits = foods
    .filter((f) => !f.hidden)
    .filter((f) => !q.query || f.name.includes(q.query))
    .filter((f) => !q.category || f.category === q.category)
    .filter((f) => !q.slot || f.slots.includes(q.slot))
    .filter((f) => !q.inStockOnly || f.inStock)
    .filter((f) => q.maxKcal === undefined || nutritionOf(f, f.defaultAmount).kcal <= q.maxKcal)
    // 手边有的食材排前面，其次是常吃的
    .sort((a, b) => Number(!!b.inStock) - Number(!!a.inStock) || b.useCount - a.useCount || a.name.localeCompare(b.name, 'zh'));
  if (!hits.length) return '没有符合条件的食物。可以放宽条件再搜，比如去掉关键词或提高 maxKcal。';
  const shown = hits.slice(0, SEARCH_LIMIT);
  const lines = shown.map((f) => {
    const n = nutritionOf(f, f.defaultAmount);
    const unit = UNIT_LABEL[f.unit];
    return `- ${f.name}（${CATEGORY_LABEL[f.category]}）一份 ${f.defaultAmount}${unit} ≈ ${Math.round(n.kcal)} kcal，蛋白质 ${Math.round(n.protein)} g；每 ${f.per}${unit} ${f.kcal} kcal${f.inStock ? '；有食材' : ''}`;
  });
  if (hits.length > shown.length) lines.push(`（共 ${hits.length} 种，只显示前 ${shown.length} 种，加条件可以缩小范围）`);
  return lines.join('\n');
}

function portionsText(items: FoodPortion[], foodsById: Map<number, FoodItem>): string {
  if (!items.length) return '（空）';
  return items.map((it) => {
    const f = foodsById.get(it.foodId);
    return f ? `${f.name} ${it.amount}${UNIT_LABEL[f.unit]}` : '（已删除的食物）';
  }).join('、');
}
