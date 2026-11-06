// Agent 循环的单元测试：用「假模型」代替真实请求，不联网。
// 假模型按脚本依次返回回复，同时记录每次收到的 messages，这样能检查循环有没有把对话拼对。
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { DENIED_RESULT, runAgent, toolDefinition, type AgentTool, type ConfirmRequest, type RequestFn } from './aiAgent';

type Block = Anthropic.Beta.BetaContentBlock;

/** 造一条模型回复。只填循环会看的字段，其余用类型断言跳过 */
function reply(content: Block[], stop: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
  return { content, stop_reason: stop } as unknown as Anthropic.Beta.BetaMessage;
}
const text = (t: string): Block => ({ type: 'text', text: t, citations: null } as Block);
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input } as Block);

/** 按脚本回复的假模型，顺便记下每次收到的请求 */
function fakeModel(script: Anthropic.Beta.BetaMessage[]) {
  const seen: Parameters<RequestFn>[0][] = [];
  const request: RequestFn = async (params) => {
    // 复制一份：循环之后还会往同一个 messages 数组里 push
    seen.push({ ...params, messages: [...params.messages] });
    const next = script.shift();
    if (!next) throw new Error('脚本用完了，模型还在被调用');
    return next;
  };
  return { request, seen };
}

const echo: AgentTool = {
  name: 'echo',
  description: '原样返回 text',
  input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  run: (input) => `echo:${String(input.text)}`,
};
const boom: AgentTool = {
  name: 'boom',
  description: '总是出错',
  input_schema: { type: 'object', properties: {} },
  run: () => { throw new Error('参数不对'); },
};

describe('runAgent', () => {
  it('模型不调工具：一次请求就结束，文字就是回答', async () => {
    const { request, seen } = fakeModel([reply([text('直接回答')], 'end_turn')]);
    const r = await runAgent({ system: 's', userText: '你好', tools: [echo], request });
    expect(r).toEqual({ text: '直接回答', steps: [], turns: 1 });
    expect(seen[0].messages).toEqual([{ role: 'user', content: '你好' }]);
    // 发给模型的工具定义只有名称、描述、schema，没有 run
    expect(seen[0].tools).toEqual([toolDefinition(echo)]);
    expect(seen[0].tools[0]).not.toHaveProperty('run');
  });

  it('调一次工具：执行后把结果以 tool_result 发回，id 对应', async () => {
    const use = toolUse('toolu_1', 'echo', { text: 'hi' });
    const { request, seen } = fakeModel([
      reply([text('我先查一下'), use], 'tool_use'),
      reply([text('查到了：hi')], 'end_turn'),
    ]);
    const steps: string[] = [];
    const turns: number[] = [];
    const r = await runAgent({ system: 's', userText: 'q', tools: [echo], request, onStep: (s) => steps.push(s.tool), onTurn: (t) => turns.push(t) });
    expect(r.text).toBe('查到了：hi');
    expect(r.turns).toBe(2);
    expect(r.steps).toEqual([{ tool: 'echo', input: { text: 'hi' }, result: 'echo:hi', isError: false }]);
    expect(steps).toEqual(['echo']);
    expect(turns).toEqual([1, 2]);
    // 第二次请求：用户提问 → 模型整段回复（含 tool_use）→ 工具结果
    expect(seen[1].messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [text('我先查一下'), use] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'echo:hi' }] },
    ]);
  });

  it('一轮调多个工具：所有结果放进同一条 user 消息，顺序一致', async () => {
    const { request, seen } = fakeModel([
      reply([toolUse('a', 'echo', { text: '1' }), toolUse('b', 'echo', { text: '2' })], 'tool_use'),
      reply([text('好')], 'end_turn'),
    ]);
    const r = await runAgent({ system: 's', userText: 'q', tools: [echo], request });
    expect(r.steps.map((s) => s.result)).toEqual(['echo:1', 'echo:2']);
    expect(seen[1].messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'echo:1' },
        { type: 'tool_result', tool_use_id: 'b', content: 'echo:2' },
      ],
    });
  });

  it('工具不存在或执行出错：不中断，错误以 is_error 发回让模型自己处理', async () => {
    const { request, seen } = fakeModel([
      reply([toolUse('a', 'nope', {}), toolUse('b', 'boom', {})], 'tool_use'),
      reply([text('换个办法')], 'end_turn'),
    ]);
    const r = await runAgent({ system: 's', userText: 'q', tools: [echo, boom], request });
    expect(r.text).toBe('换个办法');
    expect(r.steps.map((s) => s.isError)).toEqual([true, true]);
    expect(r.steps[0].result).toContain('没有叫 nope 的工具');
    expect(r.steps[1].result).toBe('参数不对');
    const results = seen[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.every((x) => x.is_error === true)).toBe(true);
  });

  it('模型给的参数不是对象时当作空对象，不让工具崩掉', async () => {
    const { request } = fakeModel([
      reply([toolUse('a', 'echo', 'not-an-object')], 'tool_use'),
      reply([text('好')], 'end_turn'),
    ]);
    const r = await runAgent({ system: 's', userText: 'q', tools: [echo], request });
    expect(r.steps[0].input).toEqual({});
  });

  it('超过 maxTurns 还在调工具：报错，不会无限循环', async () => {
    const forever = () => reply([toolUse('x', 'echo', { text: 'again' })], 'tool_use');
    const { request, seen } = fakeModel([forever(), forever(), forever(), forever()]);
    await expect(runAgent({ system: 's', userText: 'q', tools: [echo], request, maxTurns: 3 })).rejects.toThrow('3 轮');
    expect(seen).toHaveLength(3);
  });

  it('被拒绝或被截断：直接报错，不执行里面的工具', async () => {
    const steps: unknown[] = [];
    const refused = fakeModel([reply([toolUse('x', 'boom', {})], 'refusal')]);
    await expect(runAgent({ system: 's', userText: 'q', tools: [boom], request: refused.request, onStep: (s) => steps.push(s) })).rejects.toThrow('没有回答');
    const cut = fakeModel([reply([toolUse('x', 'boom', {})], 'max_tokens')]);
    await expect(runAgent({ system: 's', userText: 'q', tools: [boom], request: cut.request, onStep: (s) => steps.push(s) })).rejects.toThrow('截断');
    expect(steps).toEqual([]);
  });
});

// ---------- 第 3 级：写操作要先经用户确认 ----------

/** 一个带确认的写工具：记下 run 有没有被调用过 */
function writeTool() {
  const writes: string[] = [];
  const tool: AgentTool = {
    name: 'write',
    description: '写入 text',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    confirm: (input) => {
      if (typeof input.text !== 'string') throw new Error('text 要是字符串');
      return `将写入：${input.text}`;
    },
    run: (input) => { writes.push(String(input.text)); return `已写入：${String(input.text)}`; },
  };
  return { tool, writes };
}

describe('runAgent 的写操作确认', () => {
  it('用户同意：先问再执行，确认框里是工具生成的说明', async () => {
    const { tool, writes } = writeTool();
    const { request, seen } = fakeModel([
      reply([toolUse('w1', 'write', { text: 'hi' })], 'tool_use'),
      reply([text('记好了')], 'end_turn'),
    ]);
    const asked: ConfirmRequest[] = [];
    const r = await runAgent({ system: 's', userText: 'q', tools: [tool], request, confirm: async (req) => { asked.push(req); return true; } });
    expect(asked).toEqual([{ tool: 'write', input: { text: 'hi' }, preview: '将写入：hi' }]);
    expect(writes).toEqual(['hi']);
    expect(r.steps).toEqual([{ tool: 'write', input: { text: 'hi' }, result: '已写入：hi', isError: false }]);
    expect(seen[1].messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: '已写入：hi' }] });
  });

  it('用户拒绝：不执行，把「用户没同意」当作正常结果（不是 is_error）发回模型', async () => {
    const { tool, writes } = writeTool();
    const { request, seen } = fakeModel([
      reply([toolUse('w1', 'write', { text: 'hi' })], 'tool_use'),
      reply([text('那就不记了')], 'end_turn'),
    ]);
    const r = await runAgent({ system: 's', userText: 'q', tools: [tool], request, confirm: () => false });
    expect(writes).toEqual([]);
    expect(r.text).toBe('那就不记了');
    expect(r.steps).toEqual([{ tool: 'write', input: { text: 'hi' }, result: DENIED_RESULT, isError: false, denied: true }]);
    const result = (seen[1].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(result.content).toBe(DENIED_RESULT);
    expect(result).not.toHaveProperty('is_error');
  });

  it('没有传 confirm：一律当作拒绝，绝不在没人把关时写入', async () => {
    const { tool, writes } = writeTool();
    const { request } = fakeModel([
      reply([toolUse('w1', 'write', { text: 'hi' })], 'tool_use'),
      reply([text('好')], 'end_turn'),
    ]);
    const r = await runAgent({ system: 's', userText: 'q', tools: [tool], request });
    expect(writes).toEqual([]);
    expect(r.steps[0].denied).toBe(true);
  });

  it('参数不合法：confirm 阶段就报错回传模型，不弹确认框', async () => {
    const { tool, writes } = writeTool();
    const { request } = fakeModel([
      reply([toolUse('w1', 'write', { text: 123 })], 'tool_use'),
      reply([text('改一下')], 'end_turn'),
    ]);
    let asked = 0;
    const r = await runAgent({ system: 's', userText: 'q', tools: [tool], request, confirm: () => { asked++; return true; } });
    expect(asked).toBe(0);
    expect(writes).toEqual([]);
    expect(r.steps[0]).toEqual({ tool: 'write', input: { text: 123 }, result: 'text 要是字符串', isError: true });
  });

  it('只读工具不问：同一轮里读和写混在一起，只有写的那个弹确认', async () => {
    const { tool } = writeTool();
    const { request } = fakeModel([
      reply([toolUse('a', 'echo', { text: '1' }), toolUse('b', 'write', { text: '2' })], 'tool_use'),
      reply([text('好')], 'end_turn'),
    ]);
    const asked: string[] = [];
    const r = await runAgent({ system: 's', userText: 'q', tools: [echo, tool], request, confirm: (req) => { asked.push(req.tool); return true; } });
    expect(asked).toEqual(['write']);
    expect(r.steps.map((s) => s.result)).toEqual(['echo:1', '已写入：2']);
  });
});
