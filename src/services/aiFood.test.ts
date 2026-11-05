import { describe, expect, it } from 'vitest';
import { checkDraft, draftAmount, draftToFood, parseEstimateOutput, type FoodDraft } from './aiFood';

function draft(extra: Partial<FoodDraft> = {}): FoodDraft {
  return {
    text: '半份宫保鸡丁', name: '宫保鸡丁', category: 'protein', unit: 'g',
    kcal: 180, protein: 13, carbs: 8, fat: 11, defaultAmount: 200, amount: 100, ...extra,
  };
}

describe('parseEstimateOutput', () => {
  it('包在代码块里、数字写成字符串：照样取出', () => {
    const raw = '```json\n{"foods":[{"text":"一罐可乐","name":"可乐","category":"drink","unit":"ml","kcal":"43","protein":0,"carbs":10.6,"fat":0,"defaultAmount":330,"amount":330}]}\n```';
    expect(parseEstimateOutput(raw)).toEqual([
      { text: '一罐可乐', name: '可乐', category: 'drink', unit: 'ml', kcal: 43, protein: 0, carbs: 10.6, fat: 0, defaultAmount: 330, amount: 330 },
    ]);
  });
  it('分类不认识：归为其他；单位不认识或没有名称：丢掉', () => {
    const raw = JSON.stringify({ foods: [
      { ...draft(), category: '肉类' },
      { ...draft(), unit: '碗' },
      { ...draft(), name: ' ' },
    ] });
    const out = parseEstimateOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('other');
  });
  it('缺少 foods：报错', () => {
    expect(() => parseEstimateOutput('{"items":[]}')).toThrow();
  });
});

describe('checkDraft', () => {
  it('自洽的数据：没有错误和提醒', () => {
    // 13×4 + 8×4 + 11×9 = 183，与 180 接近
    expect(checkDraft(draft())).toEqual({ errors: [], warnings: [] });
  });
  it('热量和三大营养素对不上：提醒但允许保存', () => {
    const r = checkDraft(draft({ kcal: 400 }));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
  it('每 100 克超过 900 kcal、营养素加起来超过 100 克：错误', () => {
    expect(checkDraft(draft({ kcal: 950, protein: 0, carbs: 0, fat: 105 })).errors).toHaveLength(2);
  });
  it('按个计时不检查每 100 克的上限', () => {
    // 一个汉堡 500 kcal：25×4 + 50×4 + 22×9 = 498
    expect(checkDraft(draft({ unit: 'piece', kcal: 500, protein: 25, carbs: 50, fat: 22, defaultAmount: 1, amount: 1 })).errors).toEqual([]);
  });
  it('缺值、负数、数量离谱：错误', () => {
    expect(checkDraft(draft({ kcal: NaN })).errors.length).toBeGreaterThan(0);
    expect(checkDraft(draft({ fat: -1 })).errors.length).toBeGreaterThan(0);
    expect(checkDraft(draft({ amount: 0 })).errors.length).toBeGreaterThan(0);
    expect(checkDraft(draft({ amount: 2500 })).errors.length).toBeGreaterThan(0);
  });
});

describe('draftToFood', () => {
  it('标记为 AI 估算、默认不进自动计划、营养值取整', () => {
    const f = draftToFood(draft({ kcal: 180.4, protein: 13.26 }), 'dinner');
    expect(f).toMatchObject({ name: '宫保鸡丁', per: 100, kcal: 180, protein: 13.3, slots: ['dinner'], autoPlan: false, source: 'ai' });
    expect(draftToFood(draft({ unit: 'piece' }), 'lunch').per).toBe(1);
  });
  it('这次吃的量按单位取整', () => {
    expect(draftAmount(draft({ amount: 103 }))).toBe(105);
    expect(draftAmount(draft({ unit: 'piece', amount: 1.3 }))).toBe(1.5);
  });
});
