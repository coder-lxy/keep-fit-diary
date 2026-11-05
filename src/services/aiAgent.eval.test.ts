// 「今天还能吃什么」Agent 的评测：用真实模型跑几个问题，检查它有没有调对工具、回答里有没有用上查到的数据。
// 会真的调用 AI、产生费用，所以只在设置了环境变量时运行，平时 npm test 会跳过。
//
// PowerShell 里运行：
//   $env:AI_EVAL_KEY='你的 Key'
//   $env:AI_EVAL_BASE_URL='https://open.bigmodel.cn/api/anthropic'   # 官方服务可不设
//   $env:AI_EVAL_MODEL='glm-5.3'                                    # 不设用默认模型
//   npm run eval:agent
//
// 和第 1 级不同，这里的回答是开放式的，没法逐字对答案。能确定地检查的是：
//   1. 该调的工具调了没有（Agent 有没有「先查再答」）；
//   2. 回答里有没有出现工具返回的关键数字和食物名（有没有用查到的数据，而不是编）。
import { afterAll, describe, expect, it } from 'vitest';
import { PRESET_FOODS } from '../domain/seed';
import type { DailyPlan, FoodItem, MealLog } from '../domain/types';
import { makeRequest, runAgent, type AgentResult } from './aiAgent';
import { buildDietSystemPrompt, buildDietTools, type DietData } from './dietTools';

const KEY = process.env.AI_EVAL_KEY ?? '';
const BASE_URL = process.env.AI_EVAL_BASE_URL ?? '';
const MODEL = process.env.AI_EVAL_MODEL ?? '';

// 固定的一天：已记早餐和午餐，吃了约 600 kcal；预算 1500，蛋白目标 110 g
const DATE = '2026-11-04';
const foods: FoodItem[] = PRESET_FOODS.map((f, i) => ({ ...f, id: i + 1, autoPlan: true, useCount: 0, hidden: false, inStock: ['鸡胸肉（生）', '西兰花', '米饭', '鸡蛋'].includes(f.name) }));
const id = (name: string) => foods.find((f) => f.name === name)!.id!;
const plan: DailyPlan = {
  date: DATE, budgetKcal: 1500, proteinG: 110, fatG: 45, carbsG: 160,
  trendState: 'normal', trendText: '最近一周平均每周下降 0.6 kg，速度合适。', advices: [],
  dayType: 'strength', dayTypeSource: 'auto', dayTypeReason: '', essentialIds: [],
  meals: [
    { slot: 'breakfast', targetKcal: 375, items: [{ foodId: id('燕麦片（干）'), amount: 40 }, { foodId: id('鸡蛋'), amount: 2 }] },
    { slot: 'lunch', targetKcal: 525, items: [{ foodId: id('米饭'), amount: 150 }, { foodId: id('鸡胸肉（生）'), amount: 120 }, { foodId: id('西兰花'), amount: 150 }] },
    { slot: 'dinner', targetKcal: 450, items: [{ foodId: id('红薯（蒸）'), amount: 150 }, { foodId: id('三文鱼'), amount: 100 }] },
    { slot: 'snack', targetKcal: 150, items: [{ foodId: id('苹果'), amount: 200 }] },
  ],
  generatedAt: '', basisWeightKg: 60,
};
const logs: MealLog[] = [
  { date: DATE, slot: 'breakfast', items: [{ foodId: id('燕麦片（干）'), amount: 40 }, { foodId: id('鸡蛋'), amount: 2 }], status: 'planned', loggedAt: '' },
  { date: DATE, slot: 'lunch', items: [{ foodId: id('米饭'), amount: 150 }, { foodId: id('鸡胸肉（生）'), amount: 100 }], status: 'modified', loggedAt: '' },
];
const data: DietData = { date: DATE, plan, logs, foods };

/** 从 get_today_logs 的实际输出里取已摄入热量，评测答案以工具返回为准 */
function eatenKcal(): number {
  const text = buildDietTools(data).find((t) => t.name === 'get_today_logs')!.run({}) as string;
  return Number(/已摄入合计：(\d+) kcal/.exec(text)![1]);
}

interface Case {
  input: string;
  /** 至少要调过这些工具 */
  tools: string[];
  /** 回答里至少要出现其中一个字符串 */
  mentionsAny?: string[];
}

const CASES: Case[] = [
  { input: '晚上还能吃什么？', tools: ['get_today_plan', 'get_today_logs', 'search_foods'], mentionsAny: foods.map((f) => f.name) },
  { input: '今天蛋白质够了吗？', tools: ['get_today_plan', 'get_today_logs'], mentionsAny: ['蛋白'] },
  { input: '想加餐，有什么低热量的？', tools: ['search_foods'], mentionsAny: foods.filter((f) => f.slots.includes('snack')).map((f) => f.name) },
  { input: '我今天吃了多少热量？', tools: ['get_today_logs'], mentionsAny: [String(eatenKcal())] },
  { input: '今天是什么训练日，预算多少？', tools: ['get_today_plan'], mentionsAny: ['1500'] },
];

function grade(c: Case, r: AgentResult): string[] {
  const problems: string[] = [];
  const used = new Set(r.steps.map((s) => s.tool));
  for (const t of c.tools) if (!used.has(t)) problems.push(`没有调用 ${t}`);
  if (r.steps.some((s) => s.isError)) problems.push(`有工具调用出错：${r.steps.filter((s) => s.isError).map((s) => `${s.tool} → ${s.result}`).join('；')}`);
  if (c.mentionsAny && !c.mentionsAny.some((m) => r.text.includes(m))) problems.push('回答里没有用到查到的数据');
  if (!r.text.trim()) problems.push('没有文字回答');
  return problems;
}

const report: string[] = [];

describe.skipIf(!KEY)(`今天还能吃什么评测（${MODEL || '默认模型'}）`, () => {
  afterAll(() => {
    const passed = report.filter((r) => r.startsWith('✓')).length;
    console.log(`\n${report.join('\n')}\n\n通过 ${passed} / ${CASES.length}\n`);
  });

  for (const c of CASES) {
    it(c.input, { timeout: 300_000 }, async () => {
      const r = await runAgent({
        system: buildDietSystemPrompt(DATE),
        userText: c.input,
        tools: buildDietTools(data),
        request: makeRequest(KEY, BASE_URL, MODEL),
      });
      const problems = grade(c, r);
      const trace = r.steps.map((s) => `${s.tool}${Object.keys(s.input).length ? JSON.stringify(s.input) : ''}`).join(' → ') || '（没调工具）';
      report.push(`${problems.length ? '✗' : '✓'} ${c.input}\n    ${r.turns} 次请求：${trace}\n    回答：${r.text.replace(/\n+/g, ' ').slice(0, 160)}${problems.length ? `\n    问题：${problems.join('；')}` : ''}`);
      expect(problems).toEqual([]);
    });
  }
});
