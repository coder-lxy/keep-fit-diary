import { describe, expect, it } from 'vitest';
import type { FoodItem } from '../domain/types';
import { buildSystemPrompt, matchParsed, mergePortions, normalizeBaseUrl, parseModelOutput } from './aiMeal';

function food(id: number, name: string, unit: FoodItem['unit'], defaultAmount: number, extra: Partial<FoodItem> = {}): FoodItem {
  return {
    id, name, category: 'other', unit, per: unit === 'g' || unit === 'ml' ? 100 : 1,
    kcal: 100, protein: 0, carbs: 0, fat: 0, defaultAmount, slots: [], autoPlan: true, useCount: 0, hidden: false, ...extra,
  };
}

const rice = food(1, '米饭', 'g', 150);
const egg = food(2, '鸡蛋', 'piece', 1);
const hiddenFood = food(3, '可乐', 'ml', 330, { hidden: true });
const byId = new Map([rice, egg, hiddenFood].map((f) => [f.id!, f]));

describe('matchParsed', () => {
  it('正常条目按单位取整', () => {
    const r = matchParsed([
      { text: '一碗米饭', foodId: 1, amount: 152 },
      { text: '一个半鸡蛋', foodId: 2, amount: 1.4 },
    ], byId);
    expect(r.items).toEqual([{ foodId: 1, amount: 150 }, { foodId: 2, amount: 1.5 }]);
    expect(r.unmatched).toEqual([]);
  });
  it('foodId 为 null、不存在或已隐藏：归为库里没有，保留原话片段', () => {
    const r = matchParsed([
      { text: '一份宫保鸡丁', foodId: null, amount: 1 },
      { text: '一块蛋糕', foodId: 99, amount: 1 },
      { text: '一罐可乐', foodId: 3, amount: 330 },
    ], byId);
    expect(r.items).toEqual([]);
    expect(r.unknown).toEqual(['一份宫保鸡丁', '一块蛋糕', '一罐可乐']);
    expect(r.unmatched).toEqual([]);
  });
  it('数量为 0、负数或超过默认份量 10 倍：归为未识别', () => {
    const r = matchParsed([
      { text: '米饭', foodId: 1, amount: 0 },
      { text: '鸡蛋', foodId: 2, amount: -1 },
      { text: '米饭', foodId: 1, amount: 1600 },
    ], byId);
    expect(r.items).toEqual([]);
    expect(r.unmatched).toHaveLength(3);
  });
  it('同一种食物出现两次：数量合并', () => {
    const r = matchParsed([
      { text: '一碗米饭', foodId: 1, amount: 150 },
      { text: '又添了半碗', foodId: 1, amount: 75 },
    ], byId);
    expect(r.items).toEqual([{ foodId: 1, amount: 225 }]);
  });
});

describe('mergePortions', () => {
  it('并入已有条目时不改动原数组', () => {
    const base = [{ foodId: 1, amount: 100 }];
    const out = mergePortions(base, [{ foodId: 1, amount: 50 }, { foodId: 2, amount: 1 }]);
    expect(out).toEqual([{ foodId: 1, amount: 150 }, { foodId: 2, amount: 1 }]);
    expect(base).toEqual([{ foodId: 1, amount: 100 }]);
  });
});

describe('parseModelOutput', () => {
  it('纯 JSON', () => {
    expect(parseModelOutput('{"items":[{"text":"米饭","foodId":1,"amount":150}]}'))
      .toEqual([{ text: '米饭', foodId: 1, amount: 150 }]);
  });
  it('包在代码块里、前后有解释文字', () => {
    const raw = '好的，识别结果如下：\n```json\n{"items":[{"text":"鸡蛋","foodId":2,"amount":1}]}\n```\n希望有帮助';
    expect(parseModelOutput(raw)).toEqual([{ text: '鸡蛋', foodId: 2, amount: 1 }]);
  });
  it('数字写成字符串：转成数字；字段缺失或类型不对的条目丢掉', () => {
    const raw = JSON.stringify({ items: [
      { text: '米饭', foodId: '1', amount: '150' },
      { text: '可乐', foodId: null, amount: 1 },
      { text: '坏条目', foodId: 1 },
      null,
    ] });
    expect(parseModelOutput(raw)).toEqual([
      { text: '米饭', foodId: 1, amount: 150 },
      { text: '可乐', foodId: null, amount: 1 },
    ]);
  });
  it('不是 JSON 或缺少 items：报错', () => {
    expect(() => parseModelOutput('我没看懂')).toThrow();
    expect(() => parseModelOutput('{"foods":[]}')).toThrow();
  });
});

describe('normalizeBaseUrl', () => {
  it('去掉末尾的 / 和 /v1，留空保持为空', () => {
    expect(normalizeBaseUrl(' https://relay.example.com/ ')).toBe('https://relay.example.com');
    expect(normalizeBaseUrl('https://relay.example.com/v1/')).toBe('https://relay.example.com');
    expect(normalizeBaseUrl('https://relay.example.com/proxy')).toBe('https://relay.example.com/proxy');
    expect(normalizeBaseUrl('')).toBe('');
  });
});

describe('buildSystemPrompt', () => {
  it('列出每种食物的 id、名称和单位', () => {
    const p = buildSystemPrompt([rice, egg]);
    expect(p).toContain('1 | 米饭 | 单位：克');
    expect(p).toContain('2 | 鸡蛋 | 单位：个');
  });
});
