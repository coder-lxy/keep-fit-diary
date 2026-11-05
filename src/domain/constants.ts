// 所有规则阈值集中在这里（对应 PRD 第 7 节）。改数值不用动逻辑。

export const RULES = {
  /** 活动系数：久坐 / 轻度 / 中度 */
  activityFactor: { sedentary: 1.2, light: 1.375, moderate: 1.55 } as const,
  /** 1 kg 脂肪 ≈ 7700 kcal */
  kcalPerKg: 7700,
  /** 训练日预算只加计划运动消耗的 50% */
  trainingBurnCredit: 0.5,
  /** 经期预算上浮 */
  periodBonusKcal: 150,
  /** 下限保护 */
  floorBmrFactor: 1.1,
  floorKcal: { female: 1200, male: 1500 } as const,
  /** 蛋白质：有体脂按去脂体重 ×2.2，无体脂按体重 ×1.6；掉肌肉时提到 2.4 */
  proteinPerLbm: 2.2,
  proteinPerLbmHigh: 2.4,
  proteinPerKg: 1.6,
  /** 脂肪：体重 ×0.8 g，且不低于预算 20% */
  fatPerKg: 0.8,
  fatMinShare: 0.2,

  /** 趋势判断 */
  movingWindow: 7,
  minDaysForTrend: 7,
  prePeriodExcludeDays: 3,
  normalLow: 0.5,
  normalHigh: 1.5,
  tooFastAbsKg: 1.0,
  tooFastBudgetDelta: +150,
  tooSlowWeeks: 2,
  tooSlowBudgetDelta: -100,
  tooSlowCardioExtraMin: 10,
  plateauDays: 14,
  plateauMaxChangeKg: 0.2,
  minDietCheckinRate: 0.7,
  reboundKg: 0.3,
  /** 体脂分析 */
  bodyFatMinDays: 14,
  lbmDropKg: 0.5,
  muscleLossBudgetDelta: +100,
  /** 昨日复盘 */
  overBudgetRatio: 0.15,
  lowProteinRatio: 0.8,
  lowProteinDays: 3,

  /** 饮食计划 */
  mealSplit: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 } as const,
  mealTolerance: 0.05,
  maxPortionMultiple: 2,
  portionStepG: 5,

  /** 运动 */
  cardioExtraMax: 60,
  strengthMet: 5.0,

  /** 备份提醒 */
  backupReminderDays: 7,
} as const;

export const WEEK_DEFAULTS = {
  cardioPerWeek: 3,
  strengthPerWeek: 3,
  restPerWeek: 1,
  maxConsecutiveTraining: 3,
  cardioMinutes: 40,
} as const;
