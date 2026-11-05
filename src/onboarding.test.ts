// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useLiveQuery } from 'dexie-react-hooks';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as database from './domain/db';
import { clearAll, db, defaultSettings, ensureSeeded } from './domain/db';

// Deliberately hold the route guard's database snapshot behind the committed data.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }));
vi.mock('./pages/Today', () => ({ default: () => createElement('h1', null, '今日') }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function renderApp() {
  root.render(createElement(MemoryRouter, { initialEntries: ['/onboarding'] }, createElement(App)));
}

async function fillInitialProfile() {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    for (const [input, value] of [[inputs[1], '65'], [inputs[3], '55']] as const) {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

function startButton() {
  return container.querySelector<HTMLButtonElement>('button.primary')!;
}

async function waitForSave() {
  await act(async () => {
    await vi.waitFor(async () => {
      expect((await db.settings.get(1))?.onboarded).toBe(true);
    });
  });
}

beforeEach(async () => {
  vi.mocked(useLiveQuery).mockReturnValue(defaultSettings());
  await clearAll();
  await ensureSeeded();
  vi.spyOn(database, 'ensureSeeded').mockResolvedValue();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { renderApp(); });
  expect(container.textContent).toContain('欢迎使用减脂日记');
  await fillInitialProfile();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('首次录入', () => {
  it('数据库已保存但页面状态刷新较慢时，保留填写内容，更新后进入首页', async () => {
    await act(async () => { startButton().click(); });
    await waitForSave();

    // A premature navigation used to remount the form and clear these values.
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(inputs[1].value).toBe('65');
    expect(inputs[3].value).toBe('55');
    expect(await db.bodyRecords.count()).toBe(1);
    expect(await db.foods.count()).toBeGreaterThan(0);

    vi.mocked(useLiveQuery).mockReturnValue((await db.settings.get(1))!);
    await act(async () => { renderApp(); });
    expect(container.querySelector('h1')?.textContent).toBe('今日');
    expect(container.textContent).not.toContain('欢迎使用减脂日记');
  });

  it('保存失败时保留表单并回滚数据，重试只产生一条体重记录', async () => {
    vi.spyOn(db.settings, 'update').mockRejectedValueOnce(new Error('存储暂不可用'));
    await act(async () => { startButton().click(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('存储暂不可用');
    });

    expect(await db.profile.count()).toBe(0);
    expect(await db.bodyRecords.count()).toBe(0);
    expect(await db.foods.count()).toBe(0);
    expect((await db.settings.get(1))?.onboarded).toBe(false);
    expect(startButton().disabled).toBe(false);
    expect(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1].value).toBe('65');

    await act(async () => { startButton().click(); });
    await waitForSave();
    expect(await db.bodyRecords.count()).toBe(1);
  });

  it('连续点击开始使用只保存一次', async () => {
    await act(async () => {
      const button = startButton();
      button.click();
      button.click();
    });
    await waitForSave();
    expect(await db.bodyRecords.count()).toBe(1);
    expect(startButton().disabled).toBe(true);
  });
});
