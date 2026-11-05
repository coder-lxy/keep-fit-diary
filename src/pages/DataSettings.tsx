import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/ui';
import { addDays, today } from '../domain/dates';
import { clearAll, db, exportAll, importAll, type BackupFile } from '../domain/db';
import { AI_MODEL, getApiKey, getBaseUrl, getModel, setApiKey, setBaseUrl, setModel } from '../services/aiMeal';
import { pickFile, saveFile } from '../services/files';
import { daysSince, summarizeRange, toCsv } from '../services/stats';

export default function DataSettings() {
  const nav = useNavigate();
  const settings = useLiveQuery(() => db.settings.get(1), []);
  const d = daysSince(settings?.lastBackupAt);
  const [apiKey, setKeyInput] = useState(getApiKey);
  const [baseUrl, setBaseUrlInput] = useState(getBaseUrl);
  const [model, setModelInput] = useState(getModel);

  async function exportJson() {
    const data = await exportAll();
    await saveFile(`减脂日记备份-${today()}.json`, JSON.stringify(data), 'application/json');
  }
  async function exportCsv() {
    const first = (await db.bodyRecords.orderBy('date').first())?.date ?? addDays(today(), -30);
    const rows = await summarizeRange(first, today());
    await saveFile(`减脂日记-${today()}.csv`, toCsv(rows), 'text/csv');
  }
  async function importJson() {
    const text = await pickFile('.json,application/json');
    if (!text) return;
    if (!confirm('导入会覆盖当前全部数据，确定？')) return;
    try {
      await importAll(JSON.parse(text) as BackupFile);
      alert('已恢复');
      nav('/');
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`);
    }
  }
  async function clear() {
    if (!confirm('清除全部数据？此操作不可恢复。')) return;
    if (!confirm('再确认一次：真的要清空吗？')) return;
    await clearAll();
    location.hash = '#/';
    location.reload();
  }

  return (
    <>
      <TopBar title="数据与设置" />
      <div className="card">
        <h3>备份</h3>
        <p className="muted small">{d === undefined ? '还没有备份过。' : `上次备份：${d} 天前。`}数据只存在这台手机的浏览器里，删掉主屏幕图标或清理 Safari 数据会丢失，建议每周导出一次到「文件」App。</p>
        <div className="stack">
          <button className="primary block" onClick={exportJson}>导出 JSON 备份</button>
          <button className="block" onClick={importJson}>从 JSON 恢复</button>
          <button className="block" onClick={exportCsv}>导出 CSV（每日一行，供外部分析）</button>
        </div>
      </div>
      <div className="card">
        <h3>AI 记饮食</h3>
        <p className="muted small">填入 API Key 后，记录饮食时可以用一句话描述。Key 和服务地址只存在这台设备的浏览器里，不会写进备份文件。</p>
        <label htmlFor="ai-key">API Key</label>
        <input id="ai-key" type="password" autoComplete="off" placeholder="sk-ant-…" value={apiKey}
          onChange={(e) => { setKeyInput(e.target.value.trim()); setApiKey(e.target.value.trim()); }} />
        <label htmlFor="ai-base-url">服务地址（留空使用官方服务）</label>
        <input id="ai-base-url" type="text" inputMode="url" autoCapitalize="off" spellCheck={false} autoComplete="off" placeholder="https://api.anthropic.com" value={baseUrl}
          onChange={(e) => { setBaseUrlInput(e.target.value.trim()); setBaseUrl(e.target.value.trim()); }} />
        <p className="muted small">填自定义地址时，Key 和饮食描述会发给这个地址，请只填你信任的服务。</p>
        <label htmlFor="ai-model">模型名（留空使用 {AI_MODEL}）</label>
        <input id="ai-model" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={AI_MODEL} value={model}
          onChange={(e) => { setModelInput(e.target.value.trim()); setModel(e.target.value.trim()); }} />
      </div>
      <div className="card">
        <h3>安装到主屏幕</h3>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>用 Safari 打开本页地址。</li>
          <li>点底部「分享」按钮，选「添加到主屏幕」。</li>
          <li>之后从主屏幕图标打开，全屏运行，离线可用。</li>
        </ol>
      </div>
      <div className="card">
        <h3>训练闹钟</h3>
        <p className="small muted">网页应用不能定时提醒，在 iPhone「时钟」里按排期设置里的训练时间设闹钟即可。休息日和经期首页会显示「今天休息」，闹钟响了直接忽略。</p>
      </div>
      <div className="card">
        <h3>危险操作</h3>
        <button className="danger block" onClick={clear}>清除全部数据</button>
      </div>
    </>
  );
}
