import { addDays, weekStartOf, weekdayIndex } from '../dates';
import type { DayType, DayTypeSource, TrendState, WorkoutSchedule } from '../types';

export interface ScheduleInput {
  date: string;
  schedule: WorkoutSchedule;
  /** 本周已经定下来的日类型（date → type），包括已过去的天 */
  weekTypes: Record<string, DayType>;
  /** 本周哪些天是经期休息（不计入休息次数） */
  periodDays: Set<string>;
  isPeriodToday: boolean;
  manualOverride?: DayType;
  trendState: TrendState;
  muscleLoss: boolean;
}

export interface ScheduleResult {
  dayType: DayType;
  source: DayTypeSource;
  reason: string;
}

const LABEL: Record<DayType, string> = { cardio: '有氧', strength: '力量', rest: '休息' };

export function decideDayType(i: ScheduleInput): ScheduleResult {
  if (i.manualOverride) {
    return { dayType: i.manualOverride, source: 'manual', reason: '你手动指定了今天的类型' };
  }
  if (i.isPeriodToday) {
    return { dayType: 'rest', source: 'period', reason: '经期内自动休息' };
  }
  if (i.schedule.mode === 'fixed') {
    const t = i.schedule.fixedWeek[weekdayIndex(i.date)] ?? 'rest';
    return { dayType: t, source: 'fixed', reason: '固定星期模式' };
  }

  const ws = weekStartOf(i.date);
  const s = i.schedule;
  let cardio = 0,
    strength = 0,
    rest = 0,
    consecutive = 0;
  let lastTraining: DayType | undefined;
  let yesterday: DayType | undefined;
  for (let d = ws; d < i.date; d = addDays(d, 1)) {
    const t = i.weekTypes[d];
    if (!t) continue;
    if (t === 'cardio') cardio++;
    else if (t === 'strength') strength++;
    else if (!i.periodDays.has(d)) rest++;
    if (t === 'rest') consecutive = 0;
    else {
      consecutive++;
      lastTraining = t;
    }
    if (d === addDays(i.date, -1)) yesterday = t;
  }
  const idx = weekdayIndex(i.date);
  const remainingDays = 7 - idx; // 含今天
  const restLeft = Math.max(0, s.restPerWeek - rest);
  const cardioLeft = Math.max(0, s.cardioPerWeek - cardio);
  const strengthLeft = Math.max(0, s.strengthPerWeek - strength);
  const summary = `本周已 ${cardio} 有氧 ${strength} 力量 ${rest} 休息`;

  const pick = (t: DayType, why: string): ScheduleResult => ({
    dayType: t,
    source: 'auto',
    reason: `${summary}，${why}`,
  });

  if (consecutive >= s.maxConsecutiveTraining && restLeft > 0) {
    return pick('rest', `已连续训练 ${consecutive} 天，今天休息`);
  }
  if (restLeft > 0 && remainingDays <= restLeft) {
    return pick('rest', '剩余天数只够安排休息');
  }
  if (cardioLeft === 0 && strengthLeft === 0) {
    return pick('rest', '本周有氧和力量次数都已完成');
  }
  if (cardioLeft === 0) return pick('strength', '本周有氧已练够，今天力量');
  if (strengthLeft === 0) return pick('cardio', '本周力量已练够，今天有氧');

  if (i.trendState === 'tooSlow' || i.trendState === 'plateau') {
    return pick('cardio', '减重偏慢，优先安排有氧');
  }
  if (i.muscleLoss) {
    return pick('strength', '去脂体重在掉，优先安排力量');
  }

  const ref = yesterday && yesterday !== 'rest' ? yesterday : lastTraining;
  if (!ref) return pick('strength', '本周第一次训练，从力量开始');
  const next: DayType = ref === 'cardio' ? 'strength' : 'cardio';
  return pick(next, `昨天${yesterday ? LABEL[yesterday] : '休息'}，今天${LABEL[next]}`);
}

export function dayTypeLabel(t: DayType): string {
  return LABEL[t];
}
