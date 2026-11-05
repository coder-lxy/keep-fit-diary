// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, nowIso, today } from '../domain/dates';
import { clearAll, db, ensureSeeded } from '../domain/db';
import * as plans from '../services/planService';
import Today from './Today';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function button(text: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
}

async function waitForUi(check: () => void) {
  await vi.waitFor(async () => {
    // Let IndexedDB events settle, then flush React before inspecting the DOM.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    check();
  });
}

beforeEach(async () => {
  await clearAll();
  await ensureSeeded();
  await db.profile.put({
    id: 1, sex: 'female', birthDate: '1995-06-01', heightCm: 165, activity: 'light',
    targetWeightKg: 55, weeklyRateKg: 0.5, cycleDays: 28, periodDays: 5, createdAt: nowIso(),
  });
  await db.settings.update(1, { onboarded: true });
  await db.bodyRecords.add({
    date: addDays(today(), -1), time: '07:00', weightKg: 62,
    source: 'manual', isDaily: true,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

async function renderToday() {
  await act(async () => {
    root.render(createElement(StrictMode, null,
      createElement(MemoryRouter, null, createElement(Today))));
  });
  await waitForUi(() => expect(button('记录体重')?.disabled).toBe(false));
}

describe('每日称重', () => {
  it('保存后正常显示今日计划', async () => {
    await renderToday();
    await act(async () => { button('记录体重').click(); });
    await waitForUi(() => expect(container.textContent).toContain('今日摄入'));
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
    expect(await db.plans.where('date').equals(today()).count()).toBe(1);
    expect(container.querySelectorAll('.meal-row:not(.workout-row)')).toHaveLength(4);
    expect(container.querySelector('h1')?.textContent).toBe('今日');
  });

  it('连续点击且体重先刷新、计划仍在生成时只保存和生成一次', async () => {
    const generate = plans.generatePlanForDate;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(plans, 'generatePlanForDate').mockImplementation(async (...args) => {
      await pending;
      return generate(...args);
    });
    try {
      await renderToday();
      await act(async () => {
        const save = button('记录体重');
        save.click();
        save.click();
      });
      await waitForUi(() => expect(container.querySelector('.grid3')?.textContent).toContain('62.0'));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
    } finally {
      await act(async () => { release(); });
      await waitForUi(() => expect(container.textContent).toContain('今日摄入'));
    }
  });

  it('体重保存失败时显示错误，保留输入并允许重试', async () => {
    await renderToday();
    vi.spyOn(db.bodyRecords, 'add').mockRejectedValueOnce(new Error('存储暂不可用'));
    await act(async () => { button('记录体重').click(); });
    await waitForUi(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('体重保存失败：存储暂不可用'));
    expect(button('记录体重').disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('62');
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(0);
    await act(async () => { button('记录体重').click(); });
    await waitForUi(() => expect(container.textContent).toContain('今日摄入'));
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
  });

  it('计划失败后保留已保存的体重，重试计划不会重复记录体重', async () => {
    const spy = vi.spyOn(plans, 'generatePlanForDate').mockRejectedValueOnce(new Error('计划暂不可用'));
    await renderToday();
    await act(async () => { button('记录体重').click(); });
    await waitForUi(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('体重已保存，计划生成失败：计划暂不可用'));
    await waitForUi(() => expect(button('重新生成计划')?.disabled).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
    await act(async () => { button('重新生成计划').click(); });
    await waitForUi(() => expect(container.textContent).toContain('今日摄入'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('已有当日体重时自动生成，失败后可主动重试且不循环生成', async () => {
    await db.bodyRecords.add({ date: today(), time: '07:00', weightKg: 61.8, source: 'manual', isDaily: true });
    const spy = vi.spyOn(plans, 'generatePlanForDate').mockRejectedValueOnce(new Error('请稍后重试'));
    await act(async () => {
      root.render(createElement(StrictMode, null,
        createElement(MemoryRouter, null, createElement(Today))));
    });
    await waitForUi(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('计划生成失败：请稍后重试'));
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { button('重新生成计划').click(); });
    await waitForUi(() => expect(container.textContent).toContain('今日摄入'));
    expect(await db.bodyRecords.where('date').equals(today()).count()).toBe(1);
  });
});
