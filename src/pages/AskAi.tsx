// 第 2 级的界面：问一句话，看 Agent 调了哪些工具、拿到了什么，最后怎么回答。
// 把每一步都显示出来，是为了学习时看清循环；正式产品可以折叠或隐藏。
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/ui';
import { today } from '../domain/dates';
import { makeRequest, runAgent, type AgentStep } from '../services/aiAgent';
import { describeAiError, getApiKey, getBaseUrl, getModel } from '../services/aiMeal';
import { buildDietSystemPrompt, buildDietTools, loadDietData } from '../services/dietTools';

const PRESETS = ['晚上还能吃什么？', '今天蛋白质够了吗？', '想加餐，有什么低热量的？', '我今天吃了多少热量？'];

export default function AskAi() {
  const date = today();
  const apiKey = getApiKey();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState(0);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

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
      // 数据在提问时读一次，工具就只是查这份快照
      const data = await loadDietData(date);
      const result = await runAgent({
        system: buildDietSystemPrompt(date),
        userText: q,
        tools: buildDietTools(data),
        request: makeRequest(apiKey, getBaseUrl(), getModel()),
        onTurn: setTurn,
        onStep: (s) => setSteps((prev) => [...prev, s]),
      });
      setAnswer(result.text || '（AI 没有给出文字回答）');
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(false);
    }
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
          <textarea rows={2} placeholder="关于今天饮食的问题，例如：晚上还能吃什么？" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <p className="muted small">AI 只能查询今天的计划、记录和食物库，不会修改任何数据。问题和查到的数据会发给 AI 服务。</p>
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
                  </summary>
                  <div className="disclosure-body">
                    <p className="muted small">返回给模型的结果</p>
                    <pre>{s.result}</pre>
                  </div>
                </details>
              </li>
            ))}
            {busy && <li className="muted small">{steps.length ? '模型在看结果，决定下一步…' : '模型在决定要查什么…'}</li>}
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
    </>
  );
}
