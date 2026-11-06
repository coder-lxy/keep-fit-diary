// 第 2 级：工具 + Agent 循环。
// 第 1 级是「一次请求、一次回复」；这一级让模型自己决定调用哪个工具，我们的代码执行工具、把结果交回模型，
// 如此往复，直到模型不再调用工具、给出最终回答。这个循环是手写的，目的是看清楚底下在发生什么。
//
//   用户提问 ─▶ 请求模型 ─▶ stop_reason 是 tool_use？
//                  ▲              │ 是：执行每个工具，把结果以 tool_result 发回 ──┐
//                  └──────────────┘                                              │
//                                 │ 否：取出文字，就是最终回答 ◀───────────────────┘
//
// 第 3 级：写操作 + 人工确认。
// 工具可以声明「执行前要确认」（confirm）。循环碰到这种工具时先生成一段给人看的说明，交给界面问用户；
// 用户同意才执行 run，拒绝就把「用户没同意」当作结果发回模型，让模型自己决定下一步（通常是问用户想怎么改）。
// 模型永远碰不到数据库：它只能「申请」写，真正写的是我们的代码，而且要先过用户这一关。
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from './aiMeal';

/**
 * 一个工具 = 给模型看的定义（名称、描述、参数的 JSON Schema）+ 我们这边真正执行的函数。
 * 模型只看得到前三样，所以「描述写得好不好」直接决定它会不会用对工具。
 */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  /** 执行工具，返回给模型看的文字。抛出的错误会以 is_error 回传给模型，让它自己纠正 */
  run: (input: Record<string, unknown>) => Promise<string> | string;
  /**
   * 写操作才有：根据参数生成一段给用户看的说明（「把晚餐记为：鸡胸肉 150 克…」），循环拿它去问用户。
   * 参数不合法时在这里就抛错，错误回传给模型，不会拿一个错的方案去打扰用户。
   * 只读工具不要设置它：确认太频繁用户会疲劳，反而什么都点「同意」。
   */
  confirm?: (input: Record<string, unknown>) => string;
}

/** 循环里的一次工具调用，留给界面展示，让人看到 Agent 做了什么 */
export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  /** 写操作被用户拒绝了：没执行，结果是告诉模型「用户没同意」 */
  denied?: boolean;
}

/** 循环问界面「这个写操作能不能执行」时带的信息 */
export interface ConfirmRequest {
  tool: string;
  input: Record<string, unknown>;
  /** 工具的 confirm 生成的说明，直接显示给用户 */
  preview: string;
}

/** 用户拒绝时发回给模型的话。写明「不要重试」，否则模型可能换个参数再申请一次 */
export const DENIED_RESULT = '用户没有同意这次操作，没有写入任何数据。不要再次调用这个工具重试；告诉用户没有记录，问问他们想怎么改。';

export interface AgentResult {
  /** 模型的最终回答 */
  text: string;
  steps: AgentStep[];
  /** 一共向模型发了几次请求 */
  turns: number;
}

/**
 * 「发一次请求」抽成函数参数：循环本身不碰网络，就能用假模型写单元测试；
 * 真正跑的时候传 makeRequest() 返回的函数。
 */
export type RequestFn = (params: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
}) => Promise<Anthropic.Beta.BetaMessage>;

export interface RunAgentOptions {
  system: string;
  userText: string;
  tools: AgentTool[];
  request: RequestFn;
  /** 最多向模型发几次请求，防止模型反复调用工具停不下来 */
  maxTurns?: number;
  /** 每次要发请求前调用，界面上可以显示「第 n 次请求」 */
  onTurn?: (turn: number) => void;
  /** 每执行完一个工具调用一次 */
  onStep?: (step: AgentStep) => void;
  /**
   * 带 confirm 的工具要执行前调用，返回 true 才执行。界面上实现成「弹确认框，等用户点按钮」。
   * 不传时一律当作拒绝：宁可写不进去，也不能在没人把关的情况下写（比如评测脚本忘了传）。
   */
  confirm?: (req: ConfirmRequest) => Promise<boolean> | boolean;
}

const DEFAULT_MAX_TURNS = 8;

/** 用真实服务发请求。参数处理和第 1 级一致：官方服务才发较新的参数 */
export function makeRequest(apiKey: string, baseUrl = '', model = ''): RequestFn {
  const { client, modelId, official } = createClient(apiKey, baseUrl, model);
  return ({ system, messages, tools }) => client.beta.messages.create({
    model: modelId,
    // 思考（thinking）占用的 token 也算在 max_tokens 里，比第 1 级给得宽一些
    max_tokens: 8192,
    // 官方服务 + 默认模型：安全分类器误拒时服务端自动换模型重试一次
    ...(official && modelId === 'claude-opus-5-5' ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    // 决定调哪个工具、算剩余预算，比拆食物多一点推理，用中档
    ...(official ? { output_config: { effort: 'medium' as const } } : {}),
    system,
    messages,
    tools,
  });
}
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const { system, tools, request, onTurn, onStep, confirm } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  // 模型没有记忆：每次请求都要把到目前为止的全部对话重新发一遍，所以用一个数组一路累积
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.userText }];
  const defs = tools.map(toolDefinition);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const steps: AgentStep[] = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    onTurn?.(turn);
    const response = await request({ system, messages, tools: defs });

    // 先看 stop_reason：被拒绝或被截断时，内容不完整，里面的工具调用也不能执行
    if (response.stop_reason === 'refusal') throw new Error('AI 没有回答这个问题，换个问法试试');
    if (response.stop_reason === 'max_tokens') throw new Error('AI 的回答太长被截断了，问得具体一点试试');

    // 把模型这一轮的回复原样接到对话里。必须是整段 content，不能只留文字：
    // 下一轮的 tool_result 要对应这里的 tool_use 块；思考块也要原样带回，模型才能接着上一轮的思路
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // 模型不再调用工具：文字块就是最终回答
      return { text: textOf(response.content), steps, turns: turn };
    }

    // 模型一轮可能同时调用多个工具。全部执行完，把所有结果放进同一条 user 消息发回：
    // 拆成多条消息会让模型以为「一次只能调一个」，以后就不并行了
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const step = await executeTool(byName, use, confirm);
      steps.push(step);
      onStep?.(step);
      // tool_use_id 把结果和模型发出的那次调用对上；多个调用时顺序和 id 都不能错
      results.push({ type: 'tool_result', tool_use_id: use.id, content: step.result, ...(step.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error(`AI 查了 ${maxTurns} 轮还没有结论，换个问法试试`);
}
/** 工具定义里只有模型需要看的三样，run 函数不发给模型 */
export function toolDefinition(tool: AgentTool): Anthropic.Beta.BetaTool {
  return { name: tool.name, description: tool.description, input_schema: tool.input_schema };
}

/**
 * 执行一个工具调用。工具不存在、参数不对、执行出错，都不中断循环，
 * 而是把错误信息当作结果发回：模型看到错误通常会换个参数再试，或者如实告诉用户。
 * 带 confirm 的工具先问用户；用户拒绝不算错误（is_error 留空），是一个正常的结果，模型要据此调整回答。
 */
async function executeTool(
  byName: Map<string, AgentTool>,
  use: Anthropic.Beta.BetaToolUseBlock,
  confirm: RunAgentOptions['confirm'],
): Promise<AgentStep> {
  // 模型给的参数是不可信输入：先确保是个对象，具体字段由各工具自己检查
  const input = isRecord(use.input) ? use.input : {};
  const tool = byName.get(use.name);
  if (!tool) return { tool: use.name, input, result: `没有叫 ${use.name} 的工具，可用的工具：${[...byName.keys()].join('、')}`, isError: true };
  try {
    if (tool.confirm) {
      // 先校验、生成说明，再问人。顺序不能反：参数本身就错的方案不该拿去让用户看
      const preview = tool.confirm(input);
      const ok = confirm ? await confirm({ tool: use.name, input, preview }) : false;
      if (!ok) return { tool: use.name, input, result: DENIED_RESULT, isError: false, denied: true };
    }
    return { tool: use.name, input, result: await tool.run(input), isError: false };
  } catch (e) {
    return { tool: use.name, input, result: e instanceof Error ? e.message : String(e), isError: true };
  }
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('').trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
