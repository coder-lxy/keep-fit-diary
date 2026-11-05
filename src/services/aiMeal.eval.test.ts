// 「一句话记录」的评测：用真实模型跑一组带标准答案的描述，看识别对了多少条。
// 会真的调用 AI、产生费用，所以只在设置了环境变量时运行，平时 npm test 会跳过。
//
// PowerShell 里运行：
//   $env:AI_EVAL_KEY='你的 Key'
//   $env:AI_EVAL_BASE_URL='https://open.bigmodel.cn/api/anthropic'   # 官方服务可不设
//   $env:AI_EVAL_MODEL='glm-5.3'                                    # 不设用默认模型
//   npm run eval:meal
//
// 改提示词后重跑，对比通过的条数。新增用例时，答案按「一个合理的人会怎么记」来定，范围放宽些。
import { afterAll, describe, expect, it } from 'vitest';
import { PRESET_FOODS } from '../domain/seed';
import type { FoodItem } from '../domain/types';
import { matchParsed, parseMealText } from './aiMeal';

const KEY = process.env.AI_EVAL_KEY ?? '';
const BASE_URL = process.env.AI_EVAL_BASE_URL ?? '';
const MODEL = process.env.AI_EVAL_MODEL ?? '';

const foods: FoodItem[] = PRESET_FOODS.map((f, i) => ({ ...f, id: i + 1, autoPlan: true, useCount: 0, hidden: false }));
const byId = new Map(foods.map((f) => [f.id!, f]));

interface Expect {
  /** 食物名；多个名字表示任选其一都算对（如「牛奶」可以是全脂或脱脂） */
  name: string | string[];
  /** 数量允许范围，按该食物的单位 */
  min: number;
  max: number;
}

interface Case {
  input: string;
  expect: Expect[];
  /** 出现了也不扣分的食物，如炒菜时的食用油 */
  optional?: string[];
}

const CASES: Case[] = [
  { input: '一碗米饭，两个鸡蛋', expect: [{ name: '米饭', min: 120, max: 200 }, { name: '鸡蛋', min: 2, max: 2 }] },
  { input: '早餐一杯无糖豆浆一个馒头', expect: [{ name: '无糖豆浆', min: 200, max: 350 }, { name: '馒头', min: 60, max: 120 }] },
  { input: '半份西兰花和一份鸡胸肉', expect: [{ name: '西兰花', min: 60, max: 90 }, { name: '鸡胸肉（生）', min: 100, max: 140 }] },
  { input: '一根香蕉', expect: [{ name: '香蕉', min: 90, max: 160 }] },
  { input: '一盒希腊酸奶加一小把蓝莓', expect: [{ name: '无糖希腊酸奶', min: 100, max: 200 }, { name: '蓝莓', min: 20, max: 100 }] },
  { input: '一个苹果', expect: [{ name: '苹果', min: 150, max: 300 }] },
  { input: '番茄炒蛋，米饭半碗', expect: [{ name: '番茄', min: 80, max: 250 }, { name: '鸡蛋', min: 1, max: 3 }, { name: '米饭', min: 50, max: 110 }], optional: ['食用油'] },
  { input: '一瓶可乐', expect: [] },
  { input: '一杯黑咖啡', expect: [{ name: '黑咖啡', min: 150, max: 400 }] },
  { input: '两片全麦面包，一杯牛奶', expect: [{ name: '全麦面包', min: 50, max: 100 }, { name: ['全脂牛奶', '脱脂牛奶'], min: 200, max: 300 }] },
  { input: '晚饭吃了150克三文鱼和一盘炒菠菜', expect: [{ name: '三文鱼', min: 145, max: 155 }, { name: '菠菜', min: 100, max: 300 }], optional: ['食用油'] },
  { input: '一小碗燕麦', expect: [{ name: '燕麦片（干）', min: 25, max: 80 }] },
  { input: '今天没吃什么', expect: [] },
  { input: '一勺蛋白粉冲水', expect: [{ name: '乳清蛋白粉', min: 20, max: 40 }] },
  { input: '两个蛋清一个全蛋', expect: [{ name: '蛋白（蛋清）', min: 2, max: 2 }, { name: '鸡蛋', min: 1, max: 1 }] },
];

/** 对照标准答案，返回问题列表；空列表表示这条完全正确 */
function grade(c: Case, got: { name: string; amount: number }[]): string[] {
  const problems: string[] = [];
  const left = [...got];
  for (const e of c.expect) {
    const names = Array.isArray(e.name) ? e.name : [e.name];
    const idx = left.findIndex((g) => names.includes(g.name));
    if (idx < 0) { problems.push(`缺少 ${names.join('/')}`); continue; }
    const [hit] = left.splice(idx, 1);
    if (hit.amount < e.min || hit.amount > e.max) problems.push(`${hit.name} 数量 ${hit.amount}，应在 ${e.min}～${e.max}`);
  }
  for (const g of left) if (!c.optional?.includes(g.name)) problems.push(`多出 ${g.name} ${g.amount}`);
  return problems;
}

const report: string[] = [];

describe.skipIf(!KEY)(`一句话记录评测（${MODEL || '默认模型'}）`, () => {
  afterAll(() => {
    const passed = report.filter((r) => r.startsWith('✓')).length;
    console.log(`\n${report.join('\n')}\n\n通过 ${passed} / ${CASES.length}\n`);
  });

  for (const c of CASES) {
    it(c.input, { timeout: 120_000 }, async () => {
      const parsed = await parseMealText(c.input, foods, KEY, BASE_URL, MODEL);
      const { items, unknown, unmatched } = matchParsed(parsed, byId);
      const got = items.map((it) => ({ name: byId.get(it.foodId)!.name, amount: it.amount }));
      const problems = grade(c, got);
      const gotText = got.map((g) => `${g.name} ${g.amount}`).join('、') || '（无）';
      const notUsed = [...unknown.map((t) => `${t}（库里没有）`), ...unmatched];
      const extra = notUsed.length ? `；未识别：${notUsed.join('、')}` : '';
      report.push(`${problems.length ? '✗' : '✓'} ${c.input} → ${gotText}${extra}${problems.length ? `\n    问题：${problems.join('；')}` : ''}`);
      expect(problems).toEqual([]);
    });
  }
});
