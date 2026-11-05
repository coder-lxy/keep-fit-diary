// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useLiveQuery } from 'dexie-react-hooks';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nowIso, today } from '../domain/dates';
import { clearAll, db, ensureSeeded } from '../domain/db';
import type { DayType } from '../domain/types';
import { generatePlanForDate } from '../services/planService';
import WorkoutCard from './WorkoutCard';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const T = today();
let container: HTMLDivElement;
let root: Root;
let pressId: number;

function Harness() {
  const plan = useLiveQuery(() => db.plans.where('date').equals(T).first(), []);
  const log = useLiveQuery(() => db.workoutLogs.where('date').equals(T).first(), []);
  return plan && log ? createElement(WorkoutCard, { plan, log }) : null;
}

function rowOf(name: string) {
  return [...container.querySelectorAll<HTMLElement>('.workout-row')].find((row) => row.querySelector('strong')?.textContent?.includes(name))!;
}

function buttonIn(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll('button')].find((item) => item.textContent === text)!;
}

async function waitForUi(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    check();
  });
}

async function click(scope: ParentNode, text: string) {
  await act(async () => { buttonIn(scope, text).click(); });
}

async function fill(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setup(dayType: DayType) {
  await generatePlanForDate(T, { manualDayType: dayType });
  await act(async () => { root.render(createElement(Harness)); });
  // 等动作库和运动类型都加载出来，行标题才是真实名称
  await waitForUi(() => expect(dayType === 'rest' ? container.querySelector('.card') : container.querySelector('.workout-row strong:not(:empty)')).not.toBeNull());
  if (dayType !== 'rest') await waitForUi(() => expect(container.textContent).not.toContain('未知动作'));
}

const workoutLog = () => db.workoutLogs.where('date').equals(T).first();

beforeEach(async () => {
  await clearAll();
  await ensureSeeded();
  await db.profile.put({
    id: 1, sex: 'female', birthDate: '1995-06-01', heightCm: 165, activity: 'light',
    targetWeightKg: 55, weeklyRateKg: 0.5, cycleDays: 28, periodDays: 5, createdAt: nowIso(),
  });
  await db.settings.update(1, { onboarded: true });
  await db.bodyRecords.add({ date: T, time: '07:00', weightKg: 62, source: 'manual', isDaily: true });
  pressId = (await db.strengthExercises.toArray()).find((e) => e.name === '哑铃卧推')!.id!;
  await db.schedule.update(1, { strengthDefault: [{ exerciseId: pressId, sets: 3, reps: 12 }] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('首页运动打卡', () => {
  it('力量日：必练和动作逐项点完成，全部完成后整体标记完成，可撤销', async () => {
    await setup('strength');
    expect(container.textContent).toContain('0 / 2');
    expect(container.querySelectorAll('.check')).toHaveLength(0);

    await click(rowOf('八段锦'), '完成');
    await waitForUi(() => expect(buttonIn(rowOf('八段锦'), '撤销')).toBeTruthy());
    expect((await workoutLog())!.completed).toBe(false);

    await click(rowOf('哑铃卧推'), '完成');
    await waitForUi(() => expect(container.textContent).toContain('✓ 已完成'));
    const log = (await workoutLog())!;
    expect(log.completed).toBe(true);
    expect(log.strengthDone).toEqual([{ exerciseId: pressId, sets: 3, reps: 12 }]);

    await click(rowOf('哑铃卧推'), '撤销');
    await waitForUi(() => expect(buttonIn(rowOf('哑铃卧推'), '完成')).toBeTruthy());
    expect((await workoutLog())!.completed).toBe(false);
  });

  it('修改实际组次后保存即记为完成，计划不变；非法值不保存', async () => {
    await setup('strength');
    await click(rowOf('哑铃卧推'), '修改');
    await fill('哑铃卧推实际组数', '0');
    await click(rowOf('哑铃卧推'), '保存');
    expect(rowOf('哑铃卧推').querySelector('[role="alert"]')?.textContent).toContain('大于 0 的整数');
    expect((await workoutLog())!.strengthDone).toEqual([]);

    await fill('哑铃卧推实际组数', '2');
    await fill('哑铃卧推实际次数', '8');
    await fill('哑铃卧推重量（kg）', '10.5');
    await click(rowOf('哑铃卧推'), '保存');
    await waitForUi(() => expect(rowOf('哑铃卧推').textContent).toContain('2 组 × 8 次 · 10.5 kg'));
    expect((await workoutLog())!.strengthDone).toEqual([{ exerciseId: pressId, sets: 2, reps: 8, weightKg: 10.5 }]);
    expect((await db.plans.where('date').equals(T).first())!.strength).toEqual([{ exerciseId: pressId, sets: 3, reps: 12 }]);
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('加动作写入当天计划，删除动作同时移除计划和实际记录，排期默认不变', async () => {
    await setup('strength');
    await click(container, '＋ 加动作');
    await click(container, '俯卧撑');
    await waitForUi(() => expect(rowOf('俯卧撑')).toBeTruthy());
    const pushId = (await db.strengthExercises.toArray()).find((e) => e.name === '俯卧撑')!.id!;
    expect((await db.plans.where('date').equals(T).first())!.strength!.map((s) => s.exerciseId)).toEqual([pressId, pushId]);

    await click(rowOf('哑铃卧推'), '完成');
    await waitForUi(() => expect(buttonIn(rowOf('哑铃卧推'), '撤销')).toBeTruthy());
    await click(rowOf('哑铃卧推'), '移除');
    await waitForUi(() => expect(rowOf('哑铃卧推')).toBeUndefined());
    expect((await db.plans.where('date').equals(T).first())!.strength).toEqual([{ exerciseId: pushId, sets: 3, reps: 10 }]);
    expect((await workoutLog())!.strengthDone).toEqual([]);
    expect((await db.schedule.get(1))!.strengthDefault).toEqual([{ exerciseId: pressId, sets: 3, reps: 12 }]);

    // 只剩已完成的动作时整体算完成
    await click(rowOf('八段锦'), '完成');
    await click(rowOf('俯卧撑'), '完成');
    await waitForUi(() => expect(container.textContent).toContain('✓ 已完成'));
    await click(container, '＋ 加动作');
    await click(container, '深蹲');
    await waitForUi(() => expect(container.textContent).not.toContain('✓ 已完成'));
    expect((await workoutLog())!.completed).toBe(false);
  });

  it('保存失败时保留草稿并提示，重试成功', async () => {
    await setup('strength');
    vi.spyOn(db.workoutLogs, 'put').mockRejectedValueOnce(new Error('存储暂不可用'));
    await click(rowOf('哑铃卧推'), '修改');
    await fill('哑铃卧推实际组数', '4');
    await click(rowOf('哑铃卧推'), '保存');
    await waitForUi(() => expect(rowOf('哑铃卧推').querySelector('[role="alert"]')?.textContent).toContain('存储暂不可用'));
    expect(container.querySelector<HTMLInputElement>('[aria-label="哑铃卧推实际组数"]')?.value).toBe('4');
    await click(rowOf('哑铃卧推'), '保存');
    await waitForUi(() => expect(rowOf('哑铃卧推').textContent).toContain('4 组 × 12 次'));
  });

  it('有氧日：一键按计划完成，也可修改时长后完成', async () => {
    await setup('cardio');
    const plan = (await db.plans.where('date').equals(T).first())!;
    const name = (await db.exerciseTypes.get(plan.cardio!.exerciseTypeId))!.name;
    await waitForUi(() => expect(rowOf(name)).toBeTruthy());

    await click(rowOf(name), '完成');
    await waitForUi(() => expect(buttonIn(rowOf(name), '撤销')).toBeTruthy());
    expect((await workoutLog())!.cardio).toEqual(plan.cardio);

    await click(rowOf(name), '修改');
    await fill('有氧时长（分钟）', '50');
    await fill('有氧消耗（kcal）', '300');
    await click(rowOf(name), '保存');
    await waitForUi(() => expect(rowOf(name).textContent).toContain('50 分钟'));
    expect((await workoutLog())!.cardio).toEqual({ exerciseTypeId: plan.cardio!.exerciseTypeId, minutes: 50, kcal: 300 });
  });

  it('休息日只显示一句话，右上角换类型可切到有氧', async () => {
    await setup('rest');
    expect(container.textContent).toContain('今天休息，好好恢复。');
    expect(container.querySelectorAll('.workout-row')).toHaveLength(0);
    expect(container.querySelector('.seg')).toBeNull();
    await click(container, '换类型');
    expect(buttonIn(container, '休息日').getAttribute('aria-pressed')).toBe('true');
    await click(container, '有氧日');
    await waitForUi(() => expect(container.querySelector('.seg')).toBeNull());
    expect((await workoutLog())!.dayType).toBe('cardio');
    expect((await workoutLog())!.dayTypeSource).toBe('manual');
  });
});
