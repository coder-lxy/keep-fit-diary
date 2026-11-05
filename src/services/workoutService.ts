import { nowIso } from '../domain/dates';
import { db } from '../domain/db';
import type { DailyPlan, StrengthSet, WorkoutLog } from '../domain/types';

type Plan = Pick<DailyPlan, 'date' | 'dayType' | 'essentialIds' | 'strength'>;
type Cardio = NonNullable<WorkoutLog['cardio']>;

export function isWorkoutComplete(log: WorkoutLog, plan: Plan): boolean {
  if (log.dayType === 'rest') return true;
  const essOk = plan.essentialIds.every((id) => log.essentialsDone.some((d) => d.essentialId === id));
  const mainOk = log.dayType === 'cardio' ? !!log.cardio : (plan.strength ?? []).every((s) => log.strengthDone.some((d) => d.exerciseId === s.exerciseId));
  return essOk && mainOk;
}

// 在事务里读取最新记录再合并，连续点击多个「完成」不会互相覆盖。
async function updateLog(plan: Plan, patch: (log: WorkoutLog) => Partial<WorkoutLog>) {
  await db.transaction('rw', db.workoutLogs, async () => {
    const log = await db.workoutLogs.where('date').equals(plan.date).first();
    if (!log) throw new Error('今天的运动记录还没生成');
    const next = { ...log, ...patch(log) };
    next.completed = isWorkoutComplete(next, plan);
    next.completedAt = next.completed ? (next.completedAt ?? nowIso()) : undefined;
    await db.workoutLogs.put(next);
  });
}

export function setEssentialDone(plan: Plan, essentialId: number, done: boolean) {
  return updateLog(plan, (log) => {
    const rest = log.essentialsDone.filter((d) => d.essentialId !== essentialId);
    return { essentialsDone: done ? [...rest, { essentialId, at: nowIso() }] : rest };
  });
}

export function saveStrength(plan: Plan, actual: StrengthSet) {
  return updateLog(plan, (log) => ({ strengthDone: [...log.strengthDone.filter((d) => d.exerciseId !== actual.exerciseId), actual] }));
}

export function undoStrength(plan: Plan, exerciseId: number) {
  return updateLog(plan, (log) => ({ strengthDone: log.strengthDone.filter((d) => d.exerciseId !== exerciseId) }));
}

// 加减动作只改当天计划，排期设置里的默认动作不变。
async function changePlanStrength(plan: Plan, change: (sets: StrengthSet[]) => StrengthSet[], patch: (log: WorkoutLog) => Partial<WorkoutLog> = () => ({})) {
  await db.transaction('rw', [db.plans, db.workoutLogs], async () => {
    const current = await db.plans.where('date').equals(plan.date).first();
    if (!current) throw new Error('今天的计划还没生成');
    const next = { ...current, strength: change(current.strength ?? []) };
    await db.plans.put(next);
    await updateLog(next, patch);
  });
}

export function addStrength(plan: Plan, set: StrengthSet) {
  return changePlanStrength(plan, (sets) => [...sets.filter((s) => s.exerciseId !== set.exerciseId), set]);
}

export function removeStrength(plan: Plan, exerciseId: number) {
  return changePlanStrength(plan, (sets) => sets.filter((s) => s.exerciseId !== exerciseId),
    (log) => ({ strengthDone: log.strengthDone.filter((d) => d.exerciseId !== exerciseId) }));
}

export function saveCardio(plan: Plan, cardio: Cardio | undefined) {
  return updateLog(plan, () => ({ cardio }));
}
