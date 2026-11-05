// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAll, db, ensureSeeded, importPresetFoods } from '../domain/db';
import { useFoods } from '../hooks';
import { generatePlanForDate } from '../services/planService';
import Ingredients from './Ingredients';

vi.mock('../hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('../hooks')>(),
  useFoods: vi.fn(),
}));
vi.mock('../services/planService', () => ({ generatePlanForDate: vi.fn(), bumpUse: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

async function renderFoods() {
  vi.mocked(useFoods).mockReturnValue(await db.foods.toArray());
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(Ingredients)));
  });
}

function button(text: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
}

beforeEach(async () => {
  await clearAll();
  await ensureSeeded();
  await importPresetFoods(['米饭']);
  vi.mocked(generatePlanForDate).mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await renderFoods();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('现有食材页面', () => {
  it('从食物库添加后直接成为现有食材，用完时移除，无需填写数量或购买状态', async () => {
    expect(container.textContent).toContain('现有 0 种');
    expect(container.textContent).not.toMatch(/本周|下周|待买|已买/);
    expect(container.querySelector('input[type="number"]')).toBeNull();

    await act(async () => { button('＋ 添加').click(); });
    const row = [...container.querySelectorAll<HTMLElement>('.sheet li')].find((item) => item.textContent?.includes('米饭'))!;
    await act(async () => {
      row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      await vi.waitFor(async () => expect((await db.foods.toArray())[0].inStock).toBe(true));
    });
    await renderFoods();
    expect(container.querySelector<HTMLInputElement>('.sheet input[type="checkbox"]')?.checked).toBe(true);
    await act(async () => { button('完成').click(); });
    expect(container.textContent).toContain('现有 1 种');

    await act(async () => {
      button('移除').click();
      await vi.waitFor(async () => expect((await db.foods.toArray())[0].inStock).toBe(false));
    });
    await renderFoods();
    expect(container.textContent).toContain('现有 0 种');
    expect(await db.foods.count()).toBe(1);
  });

  it('重排失败时显示错误，不会同时提示成功', async () => {
    vi.mocked(generatePlanForDate).mockRejectedValueOnce(new Error('还没有体重记录'));
    await act(async () => { button('重排今天').click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('还没有体重记录');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button('重排今天').disabled).toBe(false);
  });
});
