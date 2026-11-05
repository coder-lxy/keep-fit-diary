import { RULES } from '../constants';
import { addDays, isBetween } from '../dates';
import type { PeriodRecord, TrendState } from '../types';

export interface DailyPoint {
  date: string;
  weightKg: number;
  bodyFatPct?: number;
}

export interface TrendInput {
  /** 当日有效体重记录，按日期升序 */
  points: DailyPoint[];
  periods: PeriodRecord[];
  /** 评估日 */
  date: string;
  targetRateKg: number;
  /** 最近 14 天饮食打卡率 0..1 */
  dietCheckinRate: number;
}

export interface TrendResult {
  state: TrendState;
  text: string;
  advices: string[];
  budgetDeltaKcal: number;
  cardioExtraMin: number;
  addStrengthSet: boolean;
  highProtein: boolean;
  avg7?: number;
  weeklySpeedKg?: number;
  bodyFat?: BodyFatResult;
}

export interface BodyFatResult {
  text: string;
  muscleLoss: boolean;
  compositionImproving: boolean;
}

export function isPeriodDay(date: string, periods: PeriodRecord[]): boolean {
  return periods.some((p) => isBetween(date, p.start, p.end));
}

/** 经期内和经期前 3 天的点不参与趋势计算 */
export function isExcludedDay(date: string, periods: PeriodRecord[]): boolean {
  if (isPeriodDay(date, periods)) return true;
  return periods.some((p) =>
    isBetween(date, addDays(p.start, -RULES.prePeriodExcludeDays), addDays(p.start, -1)),
  );
}

/** 取 endDate 往前 window 天内的有效点求平均；不足 3 个点返回 undefined */
export function movingAverage(
  points: DailyPoint[],
  endDate: string,
  periods: PeriodRecord[],
  pick: (p: DailyPoint) => number | undefined,
  window = RULES.movingWindow,
): number | undefined {
  const start = addDays(endDate, -(window - 1));
  const vals = points
    .filter((p) => p.date >= start && p.date <= endDate && !isExcludedDay(p.date, periods))
    .map(pick)
    .filter((v): v is number => v !== undefined && v > 0);
  if (vals.length < 3) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function avg7Series(
  points: DailyPoint[],
  periods: PeriodRecord[],
  pick: (p: DailyPoint) => number | undefined = (p) => p.weightKg,
): { date: string; value: number }[] {
  return points
    .map((p) => ({ date: p.date, value: movingAverage(points, p.date, periods, pick) }))
    .filter((x): x is { date: string; value: number } => x.value !== undefined);
}

export function analyzeTrend(i: TrendInput): TrendResult {
  const weight = (p: DailyPoint) => p.weightKg;
  const validDays = i.points.filter((p) => !isExcludedDay(p.date, i.periods)).length;
  const base: TrendResult = {
    state: 'insufficient',
    text: '',
    advices: [],
    budgetDeltaKcal: 0,
    cardioExtraMin: 0,
    addStrengthSet: false,
    highProtein: false,
  };

  if (validDays < RULES.minDaysForTrend) {
    return {
      ...base,
      text: `已记录 ${validDays} 天，连续记录 ${RULES.minDaysForTrend} 天后开始分析趋势。`,
    };
  }

  const avgNow = movingAverage(i.points, i.date, i.periods, weight);
  const avgWeekAgo = movingAverage(i.points, addDays(i.date, -7), i.periods, weight);
  const avg2WeeksAgo = movingAverage(i.points, addDays(i.date, -14), i.periods, weight);
  if (avgNow === undefined || avgWeekAgo === undefined) {
    return { ...base, text: '最近一周有效体重数据不足（经期前后不计），暂不判断。', avg7: avgNow };
  }

  const speed = avgWeekAgo - avgNow; // 正数 = 下降
  const r = (n: number) => Math.round(n * 100) / 100;
  const result: TrendResult = { ...base, avg7: r(avgNow), weeklySpeedKg: r(speed) };
  const target = i.targetRateKg;

  // 体脂分析
  result.bodyFat = analyzeBodyFat(i);
  if (result.bodyFat?.muscleLoss) {
    result.highProtein = true;
    result.budgetDeltaKcal += RULES.muscleLossBudgetDelta;
    result.advices.push(result.bodyFat.text);
  }

  // 反弹
  if (-speed > RULES.reboundKg && !isPeriodDay(i.date, i.periods)) {
    result.state = 'rebound';
    result.text = `7 日均重较上周回升 ${r(-speed)} kg。`;
    result.advices.push('检查近 3 日的摄入记录，预算暂不调整。');
    return result;
  }

  // 平台期：14 天内 avg7 变化 < 0.2 kg
  const change14 = avg2WeeksAgo !== undefined ? avg2WeeksAgo - avgNow : undefined;
  if (
    change14 !== undefined &&
    Math.abs(change14) < RULES.plateauMaxChangeKg &&
    i.dietCheckinRate >= RULES.minDietCheckinRate &&
    !(result.bodyFat?.compositionImproving)
  ) {
    result.state = 'plateau';
    result.text = `7 日均重 14 天内只变化 ${r(change14)} kg，进入平台期。`;
    result.advices.push('复核食物库里常吃食物的份量是否偏小。');
    result.advices.push('力量日每个动作加 1 组，有氧日 +10 分钟。');
    result.advices.push('可以自选 1 天做高碳日：在「我的 › 档案与目标」里手动覆盖当天预算到总消耗，第二天恢复自动。');
    result.addStrengthSet = true;
    result.cardioExtraMin = RULES.tooSlowCardioExtraMin;
    return result;
  }

  if (speed > RULES.normalHigh * target || speed > RULES.tooFastAbsKg) {
    result.state = 'tooFast';
    result.text = `7 日均重本周下降 ${r(speed)} kg，快于目标 ${target} kg。`;
    result.budgetDeltaKcal += RULES.tooFastBudgetDelta;
    result.advices.push('预算 +150 kcal，优先补蛋白，保住肌肉。');
    return result;
  }

  if (speed < RULES.normalLow * target) {
    const prevSpeed =
      avg2WeeksAgo !== undefined ? avg2WeeksAgo - avgWeekAgo : undefined;
    const twoWeeksSlow = prevSpeed !== undefined && prevSpeed < RULES.normalLow * target;
    if (twoWeeksSlow) {
      result.state = 'tooSlow';
      result.text = `7 日均重连续 2 周下降不到目标的一半（本周 ${r(speed)} kg）。`;
      if (i.dietCheckinRate < RULES.minDietCheckinRate) {
        result.advices.push(
          `最近饮食打卡率 ${Math.round(i.dietCheckinRate * 100)}%，先把记录补全再调预算。`,
        );
      } else {
        result.budgetDeltaKcal += RULES.tooSlowBudgetDelta;
        result.cardioExtraMin = RULES.tooSlowCardioExtraMin;
        result.advices.push('预算 −100 kcal，有氧日 +10 分钟。');
      }
      return result;
    }
    result.state = 'normal';
    result.text = `7 日均重本周下降 ${r(speed)} kg，略慢于目标，再观察一周。`;
    return result;
  }

  result.state = 'normal';
  result.text = `7 日均重本周下降 ${r(speed)} kg，速度正常。`;
  return result;
}

export function analyzeBodyFat(i: TrendInput): BodyFatResult | undefined {
  const withBf = i.points.filter((p) => p.bodyFatPct && p.bodyFatPct > 0);
  if (withBf.length < RULES.bodyFatMinDays) return undefined;
  const lbm = (p: DailyPoint) =>
    p.bodyFatPct ? p.weightKg * (1 - p.bodyFatPct / 100) : undefined;
  const bf = (p: DailyPoint) => p.bodyFatPct;
  const lbmNow = movingAverage(i.points, i.date, i.periods, lbm);
  const lbmPrev = movingAverage(i.points, addDays(i.date, -14), i.periods, lbm);
  const bfNow = movingAverage(i.points, i.date, i.periods, bf);
  const bfPrev = movingAverage(i.points, addDays(i.date, -14), i.periods, bf);
  const wNow = movingAverage(i.points, i.date, i.periods, (p) => p.weightKg);
  const wPrev = movingAverage(i.points, addDays(i.date, -14), i.periods, (p) => p.weightKg);
  if ([lbmNow, lbmPrev, bfNow, bfPrev, wNow, wPrev].some((v) => v === undefined)) return undefined;

  const lbmDrop = lbmPrev! - lbmNow!;
  const bfDrop = bfPrev! - bfNow!;
  const wDrop = wPrev! - wNow!;
  if (lbmDrop > RULES.lbmDropKg && bfDrop <= 0) {
    return {
      muscleLoss: true,
      compositionImproving: false,
      text: `两周去脂体重下降 ${lbmDrop.toFixed(1)} kg 而体脂率未降，掉的主要是肌肉：蛋白目标提高，缺口减 100 kcal。`,
    };
  }
  if (bfDrop > 0.3 && Math.abs(wDrop) < RULES.plateauMaxChangeKg) {
    return {
      muscleLoss: false,
      compositionImproving: true,
      text: `体脂率两周下降 ${bfDrop.toFixed(1)}%，体重持平，体成分在改善，不算平台期。`,
    };
  }
  if (bfDrop > 0 && wDrop > 0) {
    return { muscleLoss: false, compositionImproving: false, text: '体脂率和体重同步下降，方向正确。' };
  }
  return undefined;
}
