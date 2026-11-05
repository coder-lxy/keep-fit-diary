import { describe, expect, it } from 'vitest';
import type { DayType, WorkoutSchedule } from '../types';
import { decideDayType } from './schedule';

const sched: WorkoutSchedule = {
  id: 1, mode: 'auto', cardioPerWeek: 3, strengthPerWeek: 3, restPerWeek: 1, maxConsecutiveTraining: 3,
  fixedWeek: ['cardio', 'strength', 'cardio', 'strength', 'cardio', 'strength', 'rest'],
  cardioDefault: { exerciseTypeId: 1, minutes: 40 }, strengthDefault: [],
};
// 2026-10-26 是周一
const base = (date: string, weekTypes: Record<string, DayType>, extra: Partial<Parameters<typeof decideDayType>[0]> = {}) =>
  decideDayType({ date, schedule: sched, weekTypes, periodDays: new Set(), isPeriodToday: false, trendState: 'normal', muscleLoss: false, ...extra });

describe('schedule', () => {
  it('手动 > 经期 > 固定', () => {
    expect(base('2026-10-26', {}, { manualOverride: 'rest', isPeriodToday: true }).dayType).toBe('rest');
    expect(base('2026-10-26', {}, { isPeriodToday: true }).source).toBe('period');
    expect(base('2026-10-27', {}, { schedule: { ...sched, mode: 'fixed' } })).toMatchObject({ dayType: 'strength', source: 'fixed' });
  });
  it('周一从力量开始，之后交替', () => {
    expect(base('2026-10-26', {}).dayType).toBe('strength');
    expect(base('2026-10-27', { '2026-10-26': 'strength' }).dayType).toBe('cardio');
    expect(base('2026-10-28', { '2026-10-26': 'strength', '2026-10-27': 'cardio' }).dayType).toBe('strength');
  });
  it('连续 3 天训练后休息', () => {
    const r = base('2026-10-29', { '2026-10-26': 'strength', '2026-10-27': 'cardio', '2026-10-28': 'strength' });
    expect(r.dayType).toBe('rest');
  });
  it('休息后接上一个训练日的另一种', () => {
    const r = base('2026-10-30', { '2026-10-26': 'strength', '2026-10-27': 'cardio', '2026-10-28': 'strength', '2026-10-29': 'rest' });
    expect(r.dayType).toBe('cardio');
  });
  it('一种次数用完排另一种；都用完休息', () => {
    const week: Record<string, DayType> = { '2026-10-26': 'cardio', '2026-10-27': 'rest', '2026-10-28': 'cardio', '2026-10-29': 'cardio' };
    expect(base('2026-10-30', week).dayType).toBe('strength');
    const full: Record<string, DayType> = { '2026-10-26': 'cardio', '2026-10-27': 'strength', '2026-10-28': 'cardio', '2026-10-29': 'strength', '2026-10-30': 'cardio', '2026-10-31': 'strength' };
    expect(base('2026-11-01', full).dayType).toBe('rest');
  });
  it('平台期优先有氧，掉肌肉优先力量', () => {
    expect(base('2026-10-27', { '2026-10-26': 'cardio' }, { trendState: 'plateau' }).dayType).toBe('cardio');
    expect(base('2026-10-27', { '2026-10-26': 'strength' }, { muscleLoss: true }).dayType).toBe('strength');
  });
  it('经期休息不占休息次数', () => {
    const r = base('2026-10-28', { '2026-10-26': 'rest', '2026-10-27': 'rest' }, { periodDays: new Set(['2026-10-26', '2026-10-27']) });
    expect(r.dayType).toBe('strength');
  });
});
