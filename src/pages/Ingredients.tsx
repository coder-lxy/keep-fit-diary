import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/ui';
import { today } from '../domain/dates';
import { CATEGORY_LABEL } from '../domain/types';
import { useFoods } from '../hooks';
import { availableIngredients, setIngredientInStock } from '../services/ingredients';
import { generatePlanForDate } from '../services/planService';
import { FoodPicker } from './MealEdit';

export default function Ingredients() {
  const foods = useFoods();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const ingredients = availableIngredients(foods ?? []).sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'zh'),
  );
  const selected = new Set(ingredients.map((food) => food.id!));
  const groups = Object.entries(CATEGORY_LABEL).map(([category, name]) => ({
    category, name, foods: ingredients.filter((food) => food.category === category),
  })).filter((group) => group.foods.length > 0);
  const missingCats = (['staple', 'protein', 'vegetable'] as const).filter(
    (category) => !ingredients.some((food) => food.autoPlan && food.category === category),
  );

  async function change(foodId: number, inStock: boolean) {
    setError('');
    setMessage('');
    try {
      await setIngredientInStock(foodId, inStock);
      setMessage('食材已更新，可重排今天的饮食。');
    } catch (e) {
      setError(`更新失败：${(e as Error).message}`);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await generatePlanForDate(today(), { mealsOnly: true });
      setMessage('今天的饮食计划已按现有食材重新生成。');
    } catch (e) {
      setError(`重排失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="有啥吃啥" right={<button className="sm primary" disabled={!foods?.length || busy} onClick={() => setPicking(true)}>＋ 添加</button>} />
      <p className="section-note">食材长期保留。饮食计划优先从现有食材里选，缺哪类再从食物库里补，变更后可重排今天的饮食，已有打卡保留。</p>
      {error && <p className="notice" role="alert">{error}</p>}
      {message && <p className="advice" role="status">{message}</p>}
      {foods === undefined ? <p className="muted">加载中…</p> : (
        <>
          <div className="card ingredients-card">
            <div className="card-head"><h2>现有 {ingredients.length} 种</h2></div>
            {ingredients.length > 0 && missingCats.length > 0 && (
              <p className="ingredients-missing">缺少{missingCats.map((category) => CATEGORY_LABEL[category]).join('、')}，部分餐次可能不完整。</p>
            )}
            {groups.map((group) => (
              <section className="ingredient-group" key={group.category} aria-label={group.name}>
                <h3>{group.name}<span>{group.foods.length}</span></h3>
                <ul className="list">
                  {group.foods.map((food) => (
                    <li key={food.id}>
                      <div className="grow ingredient-name"><span>{food.name}</span>{!food.autoPlan && <span className="ingredient-inactive">不参与计划</span>}</div>
                      <button className="sm ghost" title="用完后移除" disabled={busy} onClick={() => change(food.id!, false)}>移除</button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {ingredients.length === 0 && <div className="ingredients-empty"><p>还没有食材</p><span>点右上角「添加」，选择手边有的食材。</span></div>}
          </div>
        </>
      )}
      <div className="ingredients-actions">
        <Link to="/me/foods">食物库 <span aria-hidden="true">›</span></Link>
        <button className="sm primary" disabled={busy || foods === undefined} onClick={regenerate}>{busy ? '正在重排…' : '重排今天'}</button>
      </div>
      {picking && (
        <FoodPicker multi selected={selected} foods={(foods ?? []).filter((food) => !food.hidden)}
          onPick={(food) => change(food.id!, !selected.has(food.id!))} onClose={() => setPicking(false)} />
      )}
    </>
  );
}
