import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, nowIso, today, weekStartOf } from '../domain/dates';
import { clearAll, db, defaultSettings, ensureSeeded, exportAll, importAll, importPresetFoods } from '../domain/db';
import { availableIngredients, setIngredientInStock } from './ingredients';

beforeEach(async () => {
  await clearAll();
  await ensureSeeded();
  await importPresetFoods();
});

async function ingredientIds() {
  const foods = await db.foods.toArray();
  return ['米饭', '鸡胸肉（生）', '西兰花', '鸡蛋', '苹果'].map((name) => foods.find((food) => food.name === name)!.id!);
}

async function stockIds() {
  return availableIngredients(await db.foods.toArray()).map((food) => food.id!).sort((a, b) => a - b);
}

async function legacyShoppingData() {
  const [rice, chicken, broccoli, eggs, apple] = await ingredientIds();
  await db.foods.toCollection().modify((food) => { delete food.inStock; });
  await db.settings.put(defaultSettings());
  const currentWeek = weekStartOf(today());
  const previous = (await db.shoppingLists.add({ weekStart: addDays(currentWeek, -7), createdAt: nowIso() }))!;
  const current = (await db.shoppingLists.add({ weekStart: currentWeek, createdAt: nowIso() }))!;
  const future = (await db.shoppingLists.add({ weekStart: addDays(currentWeek, 7), createdAt: nowIso() }))!;
  await db.shoppingItems.bulkAdd([
    { listId: previous, foodId: rice, amount: 300, unit: 'g', status: 'bought' },
    { listId: previous, foodId: chicken, amount: 300, unit: 'g', status: 'bought' },
    { listId: current, foodId: chicken, amount: 0, unit: 'g', status: 'used' },
    { listId: current, foodId: broccoli, amount: 300, unit: 'g', status: 'todo' },
    { listId: current, foodId: eggs, amount: 3, unit: 'piece', status: 'bought' },
    { listId: future, foodId: rice, amount: 0, unit: 'g', status: 'used' },
    { listId: future, foodId: apple, amount: 3, unit: 'piece', status: 'bought' },
  ]);
  return [rice, eggs].sort((a, b) => a - b);
}

describe('现有食材', () => {
  it('默认没有现有食材，添加和用完不会删除食物库记录', async () => {
    const [rice] = await ingredientIds();
    const total = await db.foods.count();
    expect(await stockIds()).toEqual([]);
    await setIngredientInStock(rice, true);
    await setIngredientInStock(rice, true);
    expect(await stockIds()).toEqual([rice]);
    await setIngredientInStock(rice, false);
    expect(await stockIds()).toEqual([]);
    expect(await db.foods.count()).toBe(total);
    await expect(setIngredientInStock(-1, true)).rejects.toThrow('食材已不存在');
  });

  it('隐藏的食材不参与候选，取消现有状态后重启也不重新添加', async () => {
    const [rice, chicken] = await ingredientIds();
    await setIngredientInStock(rice, true);
    await setIngredientInStock(chicken, true);
    await db.foods.update(chicken, { hidden: true });
    expect(await stockIds()).toEqual([rice]);
    await setIngredientInStock(rice, false);
    await ensureSeeded();
    expect(await stockIds()).toEqual([]);
  });

  it('旧清单按每种食材最近的状态迁移，排除待买、用完及未来周', async () => {
    const expected = await legacyShoppingData();
    await ensureSeeded();
    expect(await stockIds()).toEqual(expected);
    await setIngredientInStock(expected[0], false);
    await ensureSeeded();
    expect(await stockIds()).toEqual([expected[1]]);
    expect(await db.shoppingItems.count()).toBe(7);
  });

  it('旧 JSON 备份恢复时也能带入现有食材', async () => {
    const expected = await legacyShoppingData();
    const backup = await exportAll();
    await clearAll();
    await importAll(backup);
    expect(await stockIds()).toEqual(expected);
    expect((await db.settings.get(1))?.ingredientsMigrated).toBe(true);
  });

  it('新备份保留手动移除结果，不会被旧清单重新覆盖', async () => {
    const [first, second] = await legacyShoppingData();
    await ensureSeeded();
    await setIngredientInStock(first, false);
    const backup = await exportAll();
    await clearAll();
    await importAll(backup);
    expect(await stockIds()).toEqual([second]);
  });
});
