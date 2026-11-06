// 第 2 级的界面：问一句话，看 Agent 调了哪些工具、拿到了什么，最后怎么回答。
// 把每一步都显示出来，是为了学习时看清循环；正式产品可以折叠或隐藏。
// 第 3 级：Agent 要写入一餐时，循环会停下来等这里弹的确认框；用户点了「确认记录」才真正写库。
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, TopBar } from '../components/ui';
import { today } from '../domain/dates';
import { db } from '../domain/db';
import { makeRequest, runAgent, type AgentStep, type ConfirmRequest } from '../services/aiAgent';
import { describeAiError, getApiKey, getBaseUrl, getModel } from '../services/aiMeal';
import { buildDietSystemPrompt, buildDietTools, loadDietData } from '../services/dietTools';
import { saveMealLog } from '../services/planService';

const PRESETS = ['晚上还能吃什么？', '今天蛋白质够了吗？', '想加餐，有什么低热量的？', '帮我记一下晚餐：鸡胸肉 150 克、西兰花 200 克'];

/** 一次等待中的确认：说明文字 + 用户点按钮后要调用的 resolve */
interface Pending {
  req: ConfirmRequest;
  resolve: (ok: boolean) => void;
}

/** 两个写工具各自的确认框文案 */
const CONFIRM_TEXT: Record<string, { title: string; ok: string; hint: string }> = {
  log_meal: { title: 'AI 想记录一餐', ok: '确认记录', hint: '点「确认记录」才会写入；不记录的话 AI 会收到通知，不会再试。' },
  add_food: { title: 'AI 想新增食物', ok: '确认新增', hint: '营养值是 AI 估算的，可能不准；入库后会标「待核对」，可以在食物库里改。' },
};

export default function AskAi() {
  const date = today();
  const apiKey = getApiKey();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState(0);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion(q);
    setBusy(true);
    setError('');
    setAnswer('');
    setSteps([]);
    setTurn(0);
    try {
      // 数据在提问时读一次，工具就只是查这份快照；log_meal 写入后会更新快照
      const data = await loadDietData(date);
      const result = await runAgent({
        system: buildDietSystemPrompt(date, true),
        userText: q,
        // 两个写入口都在这里注入：AI 没有别的路能碰到数据库
        tools: buildDietTools(data, { saveMeal: saveMealLog, addFood: async (f) => (await db.foods.add(f)) as number }),
        request: makeRequest(apiKey, getBaseUrl(), getModel()),
        onTurn: setTurn,
        onStep: (s) => setSteps((prev) => [...prev, s]),
        // 把「等用户点按钮」变成一个 Promise：循环 await 它，界面显示确认框，点了按钮才 resolve
        confirm: (req) => new Promise<boolean>((resolve) => setPending({ req, resolve })),
      });
      setAnswer(result.text || '（AI 没有给出文字回答）');
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function decide(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <>
      <TopBar title="问问 AI" />
      {!apiKey && <div className="card"><p className="notice">还没填 API Key，去 <Link to="/me/data">数据与设置</Link> 填一下。</p></div>}
      <div className="card">
        <div className="chips">
          {PRESETS.map((p) => <button key={p} type="button" className="sm" disabled={busy || !apiKey} onClick={() => ask(p)}>{p}</button>)}
        </div>
        <div className="stack" style={{ marginTop: 10 }}>
          <textarea rows={2} placeholder="问今天的饮食，或让它记一餐，例如：帮我记一下午餐，米饭 150 克" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <p className="muted small">AI 可以查今天的计划、记录和食物库；要记录一餐或新增食物时会先弹出确认，你同意后才写入。问题和查到的数据会发给 AI 服务。</p>
          <button className="primary block" disabled={busy || !apiKey || !question.trim()} onClick={() => ask(question)}>{busy ? '思考中…' : '提问'}</button>
        </div>
      </div>

      {(busy || steps.length > 0 || answer) && (
        <div className="card">
          <div className="card-head">
            <h2>AI 做了什么</h2>
            <span className="muted small">{turn} 次请求 · {steps.length} 次工具调用</span>
          </div>
          <ol className="agent-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <details className="disclosure">
                  <summary>
                    <span>{i + 1}. 调用 <code>{s.tool}</code>{Object.keys(s.input).length > 0 && <span className="muted small"> {JSON.stringify(s.input)}</span>}</span>
                    {s.isError && <span className="pill warn">出错</span>}
                    {s.denied && <span className="pill gray">已拒绝</span>}
                  </summary>
                  <div className="disclosure-body">
                    <p className="muted small">返回给模型的结果</p>
                    <pre>{s.result}</pre>
                  </div>
                </details>
              </li>
            ))}
            {busy && <li className="muted small">{pending ? '等你确认…' : steps.length ? '模型在看结果，决定下一步…' : '模型在决定要查什么…'}</li>}
          </ol>
        </div>
      )}

      {error && <div className="card" role="alert"><p className="notice">{error}</p></div>}
      {answer && (
        <div className="card">
          <h2>回答</h2>
          <p className="answer">{answer}</p>
        </div>
      )}

      {/* 写操作的确认框。关闭（点遮罩、Esc）等于拒绝：没有明确同意就不写 */}
      {pending && (() => {
        const t = CONFIRM_TEXT[pending.req.tool] ?? { title: 'AI 想修改数据', ok: '确认', hint: '你同意后才会写入。' };
        return (
          <Sheet onClose={() => decide(false)} label={t.title}>
            <h2>{t.title}</h2>
            <p className="muted small">{t.hint}</p>
            <pre className="confirm-preview">{pending.req.preview}</pre>
            <div className="stack">
              <button className="primary block" onClick={() => decide(true)}>{t.ok}</button>
              <button className="block ghost" onClick={() => decide(false)}>不要</button>
            </div>
          </Sheet>
        );
      })()}
    </>
  );
}
