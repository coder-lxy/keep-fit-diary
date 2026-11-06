// 第 1 级：用 AI 把一句话的饮食描述拆成食物库里的条目。
// 只有一次请求、一次回复，没有工具和循环；重点是「结构化输出」和「校验模型给的结果」。
import Anthropic from '@anthropic-ai/sdk';
import { RULES } from '../domain/constants';
import { UNIT_LABEL, type FoodItem, type FoodPortion } from '../domain/types';

/** 默认模型，用户在设置里没填时使用 */
export const AI_MODEL = 'claude-opus-5-5';

// ---------- API Key ----------
// 存 localStorage 而不是 Dexie：exportAll 会把 settings 表写进备份文件，Key 不能跟着备份走。
const KEY_STORAGE = 'fatloss-ai-key';
const BASE_URL_STORAGE = 'fatloss-ai-base-url';
const MODEL_STORAGE = 'fatloss-ai-model';

function readLocal(name: string): string {
  try { return localStorage.getItem(name) ?? ''; } catch { return ''; }
}

function writeLocal(name: string, value: string): void {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch { /* 隐私模式下可能不可写，忽略 */ }
}

export const getApiKey = () => readLocal(KEY_STORAGE);
export const setApiKey = (key: string) => writeLocal(KEY_STORAGE, key);

/** 自定义服务地址，留空走官方 api.anthropic.com */
export const getBaseUrl = () => readLocal(BASE_URL_STORAGE);
export const setBaseUrl = (url: string) => writeLocal(BASE_URL_STORAGE, url);

/** 自定义模型名，留空用 AI_MODEL */
export const getModel = () => readLocal(MODEL_STORAGE);
export const setModel = (model: string) => writeLocal(MODEL_STORAGE, model);

/** SDK 会自己拼上 /v1/messages，所以去掉用户多填的末尾 / 和 /v1 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

// ---------- 请求 ----------
/** 模型返回的一条。foodId 为 null 表示食物库里没有对应的食物 */
export interface ParsedFood {
  text: string;
  foodId: number | null;
  amount: number;
}

// 结构化输出：API 保证回复是符合这个 JSON Schema 的 JSON，不用自己从一段话里抠数据。
// description 会被模型看到，相当于写给模型的字段说明。
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '用户原话里对应这个食物的片段，如「一碗米饭」' },
          foodId: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: '食物库中的 id；库里没有就填 null，不要硬凑' },
          amount: { type: 'number', description: '按该食物自己的单位换算后的数量' },
        },
        required: ['text', 'foodId', 'amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/** system prompt：告诉模型任务规则，并把食物库作为「只能从这里选」的候选列表给它 */
export function buildSystemPrompt(foods: FoodItem[]): string {
  const lines = foods.map((f) => `${f.id} | ${f.name} | 单位：${UNIT_LABEL[f.unit]} | 一份约 ${f.defaultAmount}${UNIT_LABEL[f.unit]}`);
  return [
    '你是减脂日记应用里的饮食记录助手。用户会用一句话描述吃了什么，你把它拆成食物库里的条目。',
    '',
    '规则：',
    '- 只能使用下面食物库里的 id。找不到合适的就把 foodId 设为 null，不要用名字相近但不同的食物代替。',
    '- 一道菜包含多种食材时（如「番茄炒蛋」），库里有整道菜就用整道菜，没有就拆成库里有的食材。',
    '- amount 按该食物的单位填写：单位是克就填克数，单位是个就填个数。',
    '- 用户说「一份」就用该食物的「一份」数量；说「半份」「两份」按比例算。',
    '- 用户说的是碗、勺、片等家常量词时，按中国家庭常见分量估算成克（如一碗米饭约 150 克）。',
    '- 用户没提到的食物不要添加。',
    '',
    // 官方服务有结构化输出兜底；第三方服务没有，只能靠这段说明约束格式
    '输出格式：只输出一个 JSON 对象，不要任何解释文字，也不要用代码块包裹。格式如下：',
    '{"items":[{"text":"一碗米饭","foodId":1,"amount":150}]}',
    'text 是用户原话里对应的片段；foodId 是食物库 id，找不到填 null；amount 是按该食物单位的数量。没有任何食物时输出 {"items":[]}。',
    '',
    '食物库（id | 名称 | 单位 | 一份的量）：',
    ...lines,
  ].join('\n');
}

/**
 * 从模型回复里取出 ParsedFood 列表。
 * 没有结构化输出保证时，模型可能包一层 ```json 代码块、前后加几句话、或者字段类型不对，
 * 这里尽量宽容地取出 JSON，再逐条检查字段，格式不对的条目丢掉。
 */
export function parseModelOutput(raw: string): ParsedFood[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 返回的不是 JSON，再试一次');
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('AI 返回的 JSON 格式有误，再试一次');
  }
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error('AI 返回的结果缺少 items');
  return items.flatMap((it): ParsedFood[] => {
    const { text, foodId, amount } = (it ?? {}) as Record<string, unknown>;
    const id = typeof foodId === 'string' && foodId.trim() !== '' ? Number(foodId) : foodId;
    const num = typeof amount === 'string' ? Number(amount) : amount;
    if (typeof num !== 'number' || (id !== null && typeof id !== 'number')) return [];
    return [{ text: typeof text === 'string' ? text : '', foodId: id as number | null, amount: num }];
  });
}

export async function parseMealText(text: string, foods: FoodItem[], apiKey: string, baseUrl = '', model = ''): Promise<ParsedFood[]> {
  return parseModelOutput(await requestJson(buildSystemPrompt(foods), text, OUTPUT_SCHEMA, apiKey, baseUrl, model));
}

/**
 * 发一次请求，返回模型回复的文字（应当是 JSON）。识别饮食和估算营养共用。
 * schema 只在官方服务上作为结构化输出发送；第三方服务靠 system prompt 里的格式说明。
 */
/** 按设置创建 SDK 客户端。第 1 级（结构化输出）和第 2 级（Agent 循环）共用 */
export function createClient(apiKey: string, baseUrl = '', model = ''): { client: Anthropic; modelId: string; official: boolean } {
  const normalized = normalizeBaseUrl(baseUrl);
  // 以 / 开头的是同源路径（如开发代理 /ai-proxy/zhipu），SDK 需要完整地址
  const baseURL = (normalized.startsWith('/') ? location.origin + normalized : normalized) || undefined;
  const modelId = model.trim() || AI_MODEL;
  // dangerouslyAllowBrowser：SDK 默认拒绝在浏览器里运行，防止把 Key 打包进前端。
  // 这里的 Key 是用户自己填、只存在本机的，所以可以打开。
  const client = new Anthropic({ apiKey, baseURL, dangerouslyAllowBrowser: true });
  // official：走 Anthropic 官方服务。有些参数是官方的较新功能，第三方兼容服务不一定支持，只在官方服务上发
  return { client, modelId, official: !baseURL };
}

export async function requestJson(system: string, userText: string, schema: object, apiKey: string, baseUrl = '', model = ''): Promise<string> {
  const { client, modelId, official } = createClient(apiKey, baseUrl, model);
  const response = await client.beta.messages.create({
    model: modelId,
    max_tokens: 4096,
    // 安全分类器误拒时，服务端自动换模型重试一次（仅默认模型支持）
    ...(official && modelId === AI_MODEL ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    // effort: low —— 拆食物、估营养都不需要深度推理，低档更快更省；format —— 结构化输出
    ...(official ? { output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: schema as Record<string, unknown> } } } : {}),
    system,
    messages: [{ role: 'user', content: userText }],
  });

  // 先看 stop_reason 再读内容：被拒绝或被截断时，内容不是完整的 JSON
  if (response.stop_reason === 'refusal') throw new Error('AI 没有处理这条描述，换个说法试试');
  if (response.stop_reason === 'max_tokens') throw new Error('描述太长，分几次记录吧');
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('AI 没有返回结果');
  return block.text;
}

/** 把 SDK 的错误类型翻译成给用户看的话 */
export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API Key 无效，去「数据与设置」检查一下';
  if (e instanceof Anthropic.PermissionDeniedError) return '这个 Key 没有调用权限';
  if (e instanceof Anthropic.RateLimitError) return '请求太频繁，稍等一会儿再试';
  if (e instanceof Anthropic.NotFoundError) return '服务地址或模型名不对，去「数据与设置」检查一下';
  if (e instanceof Anthropic.APIConnectionError) {
    return getBaseUrl().startsWith('http')
      ? '连不上 AI 服务。多数第三方服务不允许浏览器直接访问（跨域），本机开发时服务地址请填 /ai-proxy/zhipu 走转发'
      : '连不上 AI 服务，检查网络和服务地址';
  }
  if (e instanceof Anthropic.APIError) return `AI 服务出错（${e.status}），稍后再试`;
  return (e as Error).message;
}

// ---------- 校验 ----------
// 结构化输出只保证「格式」对，不保证「内容」对：id 可能不存在，数量可能离谱。
// 所以模型的结果要当作不可信输入，逐条检查后再用。

export interface MatchResult {
  items: FoodPortion[];
  /** 食物库里没有的原话片段，如「半份宫保鸡丁」，可以交给 AI 估算营养后新建 */
  unknown: string[];
  /** 其他没能用上的原话片段（如数量离谱），附原因，展示给用户手动处理 */
  unmatched: string[];
}

/** 单条数量超过默认份量的这么多倍，视为识别错误。第 3 级的 log_meal 也用这条规则 */
export const MAX_AMOUNT_MULTIPLE = 10;

export function matchParsed(parsed: ParsedFood[], foodsById: Map<number, FoodItem>): MatchResult {
  const items: FoodPortion[] = [];
  const unknown: string[] = [];
  const unmatched: string[] = [];
  for (const p of parsed) {
    const food = p.foodId === null ? undefined : foodsById.get(p.foodId);
    if (!food || food.hidden) {
      if (p.text.trim()) unknown.push(p.text.trim());
      continue;
    }
    if (!Number.isFinite(p.amount) || p.amount <= 0 || p.amount > food.defaultAmount * MAX_AMOUNT_MULTIPLE) {
      unmatched.push(`${p.text}（数量 ${p.amount}${UNIT_LABEL[food.unit]} 不太对）`);
      continue;
    }
    items.push({ foodId: food.id!, amount: roundAmount(p.amount, food) });
  }
  return { items: mergePortions([], items), unknown, unmatched };
}

export function roundAmount(amount: number, food: Pick<FoodItem, 'unit'>): number {
  const step = food.unit === 'g' || food.unit === 'ml' ? RULES.portionStepG : 0.5;
  return Math.max(step, Math.round(amount / step) * step);
}

/** 把新条目并入已有条目，同一种食物数量相加 */
export function mergePortions(base: FoodPortion[], extra: FoodPortion[]): FoodPortion[] {
  const out = base.map((it) => ({ ...it }));
  for (const it of extra) {
    const same = out.find((x) => x.foodId === it.foodId);
    if (same) same.amount += it.amount;
    else out.push({ ...it });
  }
  return out;
}
