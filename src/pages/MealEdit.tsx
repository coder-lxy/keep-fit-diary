import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NumberInput, Sheet, TopBar } from '../components/ui';
import { formatCn, nowIso } from '../domain/dates';
import { db } from '../domain/db';
import { nutritionOf, pickCandidates, sumNutrition } from '../domain/rules/mealPlan';
import { CATEGORY_LABEL, SLOT_LABEL, UNIT_LABEL, type FoodCategory, type FoodItem, type FoodPortion, type MealSlot, type Unit } from '../domain/types';
import { useFoods } from '../hooks';
import { checkDraft, draftAmount, draftToFood, estimateFoods, type FoodDraft } from '../services/aiFood';
import { describeAiError, getApiKey, getBaseUrl, getModel, matchParsed, mergePortions, parseMealText, type MatchResult } from '../services/aiMeal';
import { bumpUse } from '../services/planService';
import { availableIngredients } from '../services/ingredients';

export default function MealEdit() {
  const { date = '', slot = 'lunch' } = useParams<{ date: string; slot: MealSlot }>();
  const nav = useNavigate();
  const foodsAll = useFoods() ?? [];
  const foodsById = new Map(foodsAll.map((f) => [f.id!, f]));
  const plan = useLiveQuery(async () => (await db.plans.where('date').equals(date).first()) ?? null, [date]);
  const log = useLiveQuery(async () => (await db.mealLogs.where('[date+slot]').equals([date, slot]).first()) ?? null, [date, slot]);
  // 之前几天同一餐记过的内容，相同的只留最近一次
  const recent = useLiveQuery(async () => {
    const logs = await db.mealLogs.where('date').below(date).reverse().filter((l) => l.slot === slot && l.items.length > 0).limit(20).toArray();
    const seen = new Set<string>();
    return logs.filter((l) => {
      const key = portionsKey(l.items);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }, [date, slot]);
  const [items, setItems] = useState<FoodPortion[] | null>(null);
  const [initial, setInitial] = useState<FoodPortion[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([]);
  const candidates = availableIngredients(foodsAll);

  useEffect(() => {
    if (items !== null) return;
    if (log === undefined || plan === undefined) return;
    const meal = plan?.meals.find((m) => m.slot === slot);
    const start = log ? [...log.items] : [...(meal?.items ?? [])];
    setItems(start);
    setInitial(start);
  }, [log, plan, slot, items]);

  const dirty = items !== null && !sameAs(items, initial);
  // 刷新、关闭页面时由浏览器提示；页内返回按钮见 back()
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (items === null) return <main className="muted">加载中…</main>;
  const meal = plan?.meals.find((m) => m.slot === slot);
  const total = sumNutrition(items, foodsById);
  function back() {
    if (dirty && !confirm('改动还没保存，确定离开吗？')) return;
    nav(-1);
  }
  function togglePick(f: FoodItem) {
    if (items!.some((i) => i.foodId === f.id)) setItems(items!.filter((i) => i.foodId !== f.id));
    else setItems([...items!, { foodId: f.id!, amount: f.defaultAmount }]);
  }

  function setAmount(foodId: number, amount: number) {
    setItems(items!.map((it) => (it.foodId === foodId ? { ...it, amount } : it)));
  }
  function swap(foodId: number) {
    const f = foodsById.get(foodId);
    if (!f) return;
    const exclude = new Set(items!.map((i) => i.foodId));
    // 优先从现有食材里换，没有再从食物库里换
    let cands = pickCandidates(candidates, slot as MealSlot, [f.category], exclude);
    if (!cands.length) cands = pickCandidates(foodsAll, slot as MealSlot, [f.category], exclude);
    if (!cands.length) return alert(`食物库里没有其他${CATEGORY_LABEL[f.category]}可换`);
    const next = cands[Math.floor(Math.random() * cands.length)];
    setItems(items!.map((it) => (it.foodId === foodId ? { foodId: next.id!, amount: next.defaultAmount } : it)));
  }
  async function save() {
    const status = meal ? (sameAs(items!, meal.items) ? 'planned' : 'modified') : 'extra';
    await db.mealLogs.put({ id: log?.id, date, slot: slot as MealSlot, items: items!, status, loggedAt: nowIso() });
    await bumpUse(items!.map((i) => i.foodId));
    nav(-1);
  }

  return (
    <>
      <TopBar title={`${SLOT_LABEL[slot as MealSlot]} · ${date}`} onBack={back} />
      <div className="card">
        <div className="row between">
          <strong>{Math.round(total.kcal)} kcal</strong>
          <span className="muted small">蛋白 {Math.round(total.protein)} g · 碳水 {Math.round(total.carbs)} g · 脂肪 {Math.round(total.fat)} g</span>
        </div>
        <ul className="list">
          {items.map((it) => {
            const f = foodsById.get(it.foodId);
            if (!f) return null;
            return (
              <li key={it.foodId}>
                <div className="grow">
                  <div>{f.name} <span className="muted small">{Math.round(nutritionOf(f, it.amount).kcal)} kcal</span></div>
                </div>
                <input type="number" inputMode="decimal" style={{ width: 84 }} value={it.amount} step={f.unit === 'g' || f.unit === 'ml' ? 5 : 0.5}
                  onChange={(e) => setAmount(it.foodId, Number(e.target.value))} />
                <span className="muted small">{UNIT_LABEL[f.unit]}</span>
                <button className="sm ghost" onClick={() => swap(it.foodId)}>换</button>
                <button className="sm ghost" onClick={() => setItems(items.filter((x) => x.foodId !== it.foodId))}>✕</button>
              </li>
            );
          })}
        </ul>
        {aiUnmatched.length > 0 && <p className="notice">没识别到：{aiUnmatched.join('、')}。请从食物库手动添加。</p>}
        <div className="stack">
          <button className="block" onClick={() => setShowSearch(true)}>＋ 从食物库添加</button>
          {/* 没填 API Key 时不显示 AI 入口 */}
          {getApiKey() && <button className="block" onClick={() => setShowAi(true)}>用一句话记录（AI）</button>}
        </div>
      </div>
      {!!recent?.length && (
        <div className="card">
          <p className="muted small">最近吃过（点一下替换成这一餐）</p>
          <ul className="list">
            {recent.map((l) => (
              <li key={l.id}>
                <button type="button" className="recent-meal" onClick={() => setItems(l.items.map((i) => ({ ...i })))}>
                  <span className="grow">{l.items.map((i) => foodsById.get(i.foodId)?.name).filter(Boolean).join('、')}</span>
                  <span className="muted small">{formatCn(l.date)} · {Math.round(sumNutrition(l.items, foodsById).kcal)} kcal</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button className="primary block" onClick={save}>保存记录</button>
      {showSearch && (
        <FoodPicker
          multi
          selected={new Set(items.map((i) => i.foodId))}
          foods={foodsAll.filter((f) => !f.hidden)}
          onPick={togglePick}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showAi && (
        <AiMealSheet
          foods={foodsAll.filter((f) => !f.hidden)}
          slot={slot as MealSlot}
          onDone={(added, unmatched) => {
            // 一句话描述的是实际吃了什么，所以替换列表（包括计划里的食物）；只放进编辑列表，不直接保存：用户核对后再点「保存记录」
            // 一样都没记进来时保留原列表，免得计划被清空
            if (added.length) setItems(added);
            setAiUnmatched(unmatched);
            setShowAi(false);
          }}
          onClose={() => setShowAi(false)}
        />
      )}
    </>
  );
}

function AiMealSheet({ foods, slot, onDone, onClose }: {
  foods: FoodItem[]; slot: MealSlot; onDone: (added: FoodPortion[], unmatched: string[]) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 第二步：识别结果里有食物库没有的食物时，先让 AI 估算营养，用户核对后再写入食物库
  const [result, setResult] = useState<MatchResult | null>(null);
  const [drafts, setDrafts] = useState<FoodDraft[] | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const apiKey = getApiKey();

  async function run() {
    setBusy(true);
    setError('');
    try {
      const parsed = await parseMealText(text.trim(), foods, apiKey, getBaseUrl(), getModel());
      const r = matchParsed(parsed, new Map(foods.map((f) => [f.id!, f])));
      if (!r.items.length && !r.unknown.length && !r.unmatched.length) setError('没从描述里找到食物，换个说法试试');
      else if (!r.unknown.length) onDone(r.items, r.unmatched);
      else {
        setResult(r);
        await estimate(r.unknown);
      }
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function estimate(texts: string[]) {
    setBusy(true);
    setError('');
    try {
      const ds = await estimateFoods(texts, apiKey, getBaseUrl(), getModel());
      setDrafts(ds);
      setKeep(ds.map((d) => !checkDraft(d).errors.length));
    } catch (e) {
      setError(describeAiError(e));
    } finally {
      setBusy(false);
    }
  }

  /** 库里没有、最后也没新建的原话片段 */
  function leftover(): string[] {
    const created = new Set((drafts ?? []).filter((d, i) => keep[i] && !checkDraft(d).errors.length).map((d) => d.text));
    return result!.unknown.filter((t) => !created.has(t)).map((t) => `${t}（食物库里没有）`);
  }

  // 写操作：用户点了确认才写入食物库
  async function confirm() {
    setBusy(true);
    try {
      const added: FoodPortion[] = [];
      await db.transaction('rw', db.foods, async () => {
        for (const [i, d] of drafts!.entries()) {
          if (!keep[i] || checkDraft(d).errors.length) continue;
          // 同名同单位的食物已存在（可能被隐藏了）就直接用，不重复新建
          const same = (await db.foods.where('name').equals(d.name.trim()).toArray()).find((f) => f.unit === d.unit);
          if (same) {
            if (same.hidden) await db.foods.update(same.id!, { hidden: false });
            added.push({ foodId: same.id!, amount: draftAmount(d) });
          } else {
            const id = await db.foods.add(draftToFood(d, slot));
            added.push({ foodId: id!, amount: draftAmount(d) });
          }
        }
      });
      onDone(mergePortions(result!.items, added), [...result!.unmatched, ...leftover()]);
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(i: number, patch: Partial<FoodDraft>) {
    setDrafts(drafts!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  if (result) {
    const keptCount = drafts?.filter((d, i) => keep[i] && !checkDraft(d).errors.length).length ?? 0;
    return (
      <Sheet onClose={onClose} label="新增食物">
        <h2>食物库里没有的食物</h2>
        <p className="muted small">
          {result.items.length ? `已识别 ${result.items.length} 种库里的食物。` : ''}
          下面的营养值是 AI 估算的，可能不准，核对后再加入食物库。有包装的食物，以营养成分表为准。
        </p>
        {busy && !drafts && <p className="muted">正在估算营养…</p>}
        {error && <p className="notice">{error}</p>}
        {!busy && !drafts && <button className="block" onClick={() => estimate(result.unknown)}>重新估算</button>}
        {drafts && (
          <ul className="list">
            {drafts.map((d, i) => (
              <DraftEditor key={i} draft={d} checked={keep[i]} onCheck={(v) => setKeep(keep.map((k, j) => (j === i ? v : k)))} onChange={(p) => updateDraft(i, p)} />
            ))}
          </ul>
        )}
        <div className="stack">
          {drafts && <button className="primary block" disabled={busy || !keptCount} onClick={confirm}>加入食物库并记入这一餐（{keptCount} 种）</button>}
          <button className="block ghost" disabled={busy} onClick={() => onDone(result.items, [...result.unmatched, ...result.unknown.map((t) => `${t}（食物库里没有）`)])}>跳过，只记识别到的</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} label="用一句话记录">
      <h2>用一句话记录</h2>
      <div className="stack">
        <textarea rows={3} placeholder="例如：一碗米饭，半份宫保鸡丁，一个鸡蛋" value={text} onChange={(e) => setText(e.target.value)} />
        <p className="muted small">描述会和食物库名称一起发给 AI 服务识别，识别结果会替换这一餐现在的列表（包括计划里的食物），核对后再保存。</p>
        {error && <p className="notice">{error}</p>}
        <button className="primary block" disabled={busy || !text.trim()} onClick={run}>{busy ? '识别中…' : '识别'}</button>
      </div>
    </Sheet>
  );
}

type DraftNumberKey = 'kcal' | 'protein' | 'carbs' | 'fat' | 'defaultAmount' | 'amount';

function DraftEditor({ draft: d, checked, onCheck, onChange }: {
  draft: FoodDraft; checked: boolean; onCheck: (v: boolean) => void; onChange: (patch: Partial<FoodDraft>) => void;
}) {
  const { errors, warnings } = checkDraft(d);
  const unit = UNIT_LABEL[d.unit];
  const per = d.unit === 'g' || d.unit === 'ml' ? `每 100${unit}` : `每 1${unit}`;
  const field = (k: DraftNumberKey, label: string, step = 1, suffix?: string) => (
    <div><label>{label}</label><NumberInput value={Number.isFinite(d[k]) ? d[k] : undefined} step={step} suffix={suffix} onChange={(v) => onChange({ [k]: v ?? NaN })} /></div>
  );
  const mealKcal = errors.length ? null : Math.round((d.kcal * d.amount) / (d.unit === 'g' || d.unit === 'ml' ? 100 : 1));
  // 布局与食物库的「新增食物」一致：名称 → 分类/单位 → 营养值 → 份量
  return (
    <li className="draft-editor">
      <label className="row">
        <input type="checkbox" checked={checked && !errors.length} disabled={errors.length > 0} onChange={(e) => onCheck(e.target.checked)} />
        <span>「{d.text}」{mealKcal !== null && <span className="muted small"> 这次约 {mealKcal} kcal</span>}</span>
      </label>
      <label>名称</label>
      <input value={d.name} onChange={(e) => onChange({ name: e.target.value })} />
      <div className="grid2">
        <div><label>分类</label>
          <select value={d.category} onChange={(e) => onChange({ category: e.target.value as FoodCategory })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>单位</label>
          <select value={d.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })}>
            {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      <p className="hint">营养值按{per}填。</p>
      <div className="grid2">
        {field('kcal', '热量 kcal')}
        {field('protein', '蛋白质 g', 0.1)}
        {field('carbs', '碳水 g', 0.1)}
        {field('fat', '脂肪 g', 0.1)}
      </div>
      <div className="grid2">
        {field('defaultAmount', '默认份量', 1, unit)}
        {field('amount', '这次吃了', 1, unit)}
      </div>
      {errors.map((e) => <p key={e} className="notice">{e}</p>)}
      {warnings.map((w) => <p key={w} className="hint">⚠ {w}</p>)}
    </li>
  );
}

function sameAs(a: FoodPortion[], b: FoodPortion[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x) => b.some((y) => y.foodId === x.foodId && y.amount === x.amount));
}

/** 一餐内容的指纹，用来给「最近吃过」去重 */
function portionsKey(items: FoodPortion[]): string {
  return items.map((i) => `${i.foodId}:${i.amount}`).sort().join(',');
}

export function FoodPicker({ foods, onPick, onClose, multi, selected }: {
  foods: FoodItem[]; onPick: (f: FoodItem) => void; onClose: () => void; multi?: boolean; selected?: Set<number>;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const query = q.trim();
  const list = foods
    .filter((f) => (!query || f.name.includes(query)) && (!cat || f.category === cat))
    .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name, 'zh'));
  return (
    <Sheet onClose={onClose} className="food-picker" label={multi ? '添加食材' : '选择食物'}>
      <div className="sheet-grip" aria-hidden="true" />
      <div className="food-picker-heading">
        <div><h2>{multi ? '添加食材' : '选择食物'}</h2><p>{multi ? `已选 ${selected?.size ?? 0} 种` : `${foods.length} 种食物`}</p></div>
        <button type="button" className="sm primary food-picker-done" onClick={onClose}>{multi ? '完成' : '关闭'}</button>
      </div>
      <div className="food-picker-search"><input type="search" placeholder="搜索食材" aria-label="搜索食材" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="food-picker-categories" role="group" aria-label="食物分类">
        <button type="button" className="sm" aria-pressed={cat === ''} onClick={() => setCat('')}>全部</button>
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <button type="button" key={k} className="sm" aria-pressed={cat === k} onClick={() => setCat(k)}>{v}</button>
        ))}
      </div>
      <ul className="list food-picker-list">
        {list.map((f) => (
          <li key={f.id} className={multi && selected?.has(f.id!) ? 'selected' : undefined}>
            {multi ? (
              <label className="food-picker-row">
                <input type="checkbox" checked={selected?.has(f.id!) ?? false} onChange={() => onPick(f)} />
                <span className="food-picker-name">{f.name}</span><span className="food-picker-category">{CATEGORY_LABEL[f.category]}</span>
              </label>
            ) : (
              <button type="button" className="food-picker-row" onClick={() => onPick(f)}>
                <span className="food-picker-name">{f.name}<span className="food-picker-meta">{CATEGORY_LABEL[f.category]} · {f.kcal} kcal / {f.per}{UNIT_LABEL[f.unit]}</span></span>
                <span className="food-picker-add" aria-hidden="true">＋</span>
              </button>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="food-picker-empty muted">没有匹配的食材</li>}
      </ul>
    </Sheet>
  );
}
