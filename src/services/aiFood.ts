// 识别时遇到食物库里没有的食物：让 AI 估算营养，生成「建议新增的食物」，用户核对确认后才写入食物库。
// 这是固定流程（识别 → 没匹配上 → 估算 → 确认），不是 Agent：步骤由代码决定，模型只负责填数。
// 新的难点是校验：id 可以查表核对，营养值没有标准答案，只能检查是否自洽、是否在合理范围。
import { CATEGORY_LABEL, type FoodCategory, type FoodItem, type MealSlot, type Unit } from '../domain/types';
import { requestJson, roundAmount } from './aiMeal';

/** AI 估算出的一条新食物，用户确认前可以修改 */
export interface FoodDraft {
  /** 用户原话里的片段，如「半份宫保鸡丁」 */
  text: string;
  name: string;
  category: FoodCategory;
  unit: Unit;
  /** 营养值：g/ml 为每 100，piece/serving 为每 1，与 FoodItem 一致 */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** 一份的量 */
  defaultAmount: number;
  /** 这次吃了多少 */
  amount: number;
}

const CATEGORIES = Object.keys(CATEGORY_LABEL) as FoodCategory[];
const UNITS: Unit[] = ['g', 'ml', 'piece', 'serving'];

const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    foods: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '对应的那行原文' },
          name: { type: 'string', description: '简短通用的食物名，不带数量' },
          category: { type: 'string', enum: CATEGORIES },
          unit: { type: 'string', enum: UNITS },
          kcal: { type: 'number', description: 'g/ml 为每 100 克/毫升的热量，piece/serving 为每 1 个/份' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          defaultAmount: { type: 'number', description: '常见的一份是多少，按 unit' },
          amount: { type: 'number', description: '用户这次吃了多少，按 unit' },
        },
        required: ['text', 'name', 'category', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'defaultAmount', 'amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['foods'],
  additionalProperties: false,
};

export function buildEstimatePrompt(): string {
  const cats = CATEGORIES.map((c) => `${c}（${CATEGORY_LABEL[c]}）`).join('、');
  return [
    '你是减脂日记应用里的营养估算助手。用户会给出几行食物描述，每行一条，这些食物不在用户的食物库里。为每一行估算一个新的食物条目。',
    '',
    '规则：',
    '- name：简短通用的食物名，不带数量和量词，如「宫保鸡丁」「可乐」。',
    '- unit：菜品和散装食物用 g，饮料用 ml；大小标准、习惯按个数的（如包子、饺子）可以用 piece。尽量少用 serving。',
    '- 营养值：unit 为 g 或 ml 时按每 100 克或 100 毫升填写；为 piece 或 serving 时按每 1 个或 1 份填写。',
    '- 菜品按中国家常做法的熟重估算，包含烹饪用油。参考《中国食物成分表》的常见数值。',
    '- 饮料、零食按常规版本估算（如可乐按含糖版），用户说了无糖、低脂等才按对应版本。',
    '- kcal 应约等于 蛋白质×4 + 碳水×4 + 脂肪×9。',
    '- defaultAmount：常见的一份是多少（按 unit），如一份炒菜约 200 克，一罐可乐 330 毫升。',
    '- amount：用户这次吃了多少（按 unit）。按描述里的数量估算，如「半份」就是 defaultAmount 的一半；没说数量就按一份。',
    `- category 只能是：${cats}。`,
    '- 每一行都要输出一条，顺序和输入一致。',
    '',
    '输出格式：只输出一个 JSON 对象，不要任何解释文字，也不要用代码块包裹。格式如下：',
    '{"foods":[{"text":"半份宫保鸡丁","name":"宫保鸡丁","category":"protein","unit":"g","kcal":180,"protein":13,"carbs":8,"fat":11,"defaultAmount":200,"amount":100}]}',
  ].join('\n');
}

export async function estimateFoods(texts: string[], apiKey: string, baseUrl = '', model = ''): Promise<FoodDraft[]> {
  return parseEstimateOutput(await requestJson(buildEstimatePrompt(), texts.join('\n'), ESTIMATE_SCHEMA, apiKey, baseUrl, model));
}

/** 宽容地取出 JSON（同 parseModelOutput）；数字字段转换类型，名称为空或单位不认识的条目丢掉 */
export function parseEstimateOutput(raw: string): FoodDraft[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 返回的不是 JSON，再试一次');
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('AI 返回的 JSON 格式有误，再试一次');
  }
  const foods = (data as { foods?: unknown }).foods;
  if (!Array.isArray(foods)) throw new Error('AI 返回的结果缺少 foods');
  return foods.flatMap((it): FoodDraft[] => {
    const o = (it ?? {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    // 单位决定了营养值的含义（每 100 克还是每 1 个），猜错会差几十倍，所以不认识就丢掉，不替它猜
    if (!name || !UNITS.includes(o.unit as Unit)) return [];
    const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN);
    return [{
      text: typeof o.text === 'string' ? o.text : name,
      name: name.slice(0, 20),
      category: CATEGORIES.includes(o.category as FoodCategory) ? (o.category as FoodCategory) : 'other',
      unit: o.unit as Unit,
      kcal: num(o.kcal), protein: num(o.protein), carbs: num(o.carbs), fat: num(o.fat),
      defaultAmount: num(o.defaultAmount), amount: num(o.amount),
    }];
  });
}

export interface DraftCheck {
  /** 有错误时不能保存 */
  errors: string[];
  /** 可疑但允许保存，提醒用户核对 */
  warnings: string[];
}

/** 每 100 克最多 900 kcal（纯油脂约 900） */
const MAX_KCAL_PER_100 = 900;
/** 热量与三大营养素推算值的允许偏差：15% 或 15 kcal，取较大者。膳食纤维、酒精、取整都会造成少量偏差 */
const KCAL_TOLERANCE = 0.15;

/** 校验营养值：没有标准答案可查，只能看自洽和范围 */
export function checkDraft(d: FoodDraft): DraftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!d.name.trim()) errors.push('名称不能为空');
  const nums = [d.kcal, d.protein, d.carbs, d.fat];
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) errors.push('营养值要填非负数');
  if (!(d.defaultAmount > 0)) errors.push('一份的量要大于 0');
  if (!(d.amount > 0)) errors.push('这次吃的量要大于 0');
  else if (d.defaultAmount > 0 && d.amount > d.defaultAmount * 10) errors.push('这次吃的量超过一份的 10 倍');
  if (errors.length) return { errors, warnings };

  if (d.unit === 'g' || d.unit === 'ml') {
    if (d.kcal > MAX_KCAL_PER_100) errors.push(`每 100${d.unit === 'g' ? ' 克' : ' 毫升'}不可能超过 ${MAX_KCAL_PER_100} kcal`);
    if (d.protein + d.carbs + d.fat > 100) errors.push('每 100 克里蛋白质、碳水、脂肪加起来不可能超过 100 克');
  }
  const calc = Math.round(d.protein * 4 + d.carbs * 4 + d.fat * 9);
  if (Math.abs(d.kcal - calc) > Math.max(15, d.kcal * KCAL_TOLERANCE)) {
    warnings.push(`热量 ${d.kcal} kcal 和三大营养素算出的 ${calc} kcal 差得较多，核对一下`);
  }
  return { errors, warnings };
}

/** 转成食物库条目。默认不参与自动计划：AI 估的菜品不一定是想天天吃的，用户可以在食物库里打开 */
export function draftToFood(d: FoodDraft, slot: MealSlot): FoodItem {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    name: d.name.trim(), category: d.category, unit: d.unit, per: d.unit === 'g' || d.unit === 'ml' ? 100 : 1,
    kcal: Math.round(d.kcal), protein: r1(d.protein), carbs: r1(d.carbs), fat: r1(d.fat),
    defaultAmount: d.defaultAmount, slots: [slot], autoPlan: false, inStock: false, useCount: 0, hidden: false, source: 'ai',
  };
}

/** 这次吃的量按单位取整 */
export function draftAmount(d: FoodDraft): number {
  return roundAmount(d.amount, d);
}
