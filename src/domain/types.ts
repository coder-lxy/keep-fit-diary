// 数据模型（对应 PRD 第 6 节）。日期一律用 'YYYY-MM-DD' 字符串，零点切换。

export type Sex = 'female' | 'male';
export type Activity = 'sedentary' | 'light' | 'moderate';
export type DayType = 'cardio' | 'strength' | 'rest';
export type DayTypeSource = 'auto' | 'fixed' | 'manual' | 'period';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type FoodCategory =
  | 'staple'
  | 'protein'
  | 'vegetable'
  | 'fruit'
  | 'dairy'
  | 'snack'
  | 'drink'
  | 'other';
export type Unit = 'g' | 'ml' | 'piece' | 'serving';
export type BodyPart = 'leg' | 'glute' | 'chest' | 'back' | 'shoulder' | 'core';
/** 仅用于读取旧购物清单及兼容历史备份。 */
export type ShoppingStatus = 'todo' | 'bought' | 'used';
export type TrendState =
  | 'insufficient'
  | 'normal'
  | 'tooFast'
  | 'tooSlow'
  | 'plateau'
  | 'rebound';

export interface UserProfile {
  id: 1;
  sex: Sex;
  birthDate: string;
  heightCm: number;
  activity: Activity;
  targetWeightKg?: number;
  targetBodyFatPct?: number;
  weeklyRateKg: 0.25 | 0.5 | 0.75;
  budgetOverrideKcal?: number;
  cycleDays: number;
  periodDays: number;
  createdAt: string;
}

export interface BodyRecord {
  id?: number;
  date: string;
  time: string; // 'HH:mm'
  weightKg: number;
  bodyFatPct?: number;
  source: 'manual' | 'import';
  isDaily: boolean; // 当日有效值（第一次）
}

export interface FoodItem {
  id?: number;
  name: string;
  category: FoodCategory;
  unit: Unit;
  /** 营养值对应的基准量：g/ml 为每 100，piece/serving 为每 1 */
  per: 100 | 1;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  defaultAmount: number;
  slots: MealSlot[];
  autoPlan: boolean;
  /** 当前手边有的食材，跨周保留；未设置视为没有。 */
  inStock?: boolean;
  useCount: number;
  hidden: boolean;
  builtin?: boolean;
  /** 'ai'：营养值由 AI 估算、用户还没在食物库里核对过；在食物库编辑保存后清除 */
  source?: 'ai';
}

export interface FoodPortion {
  foodId: number;
  amount: number;
}

export interface PlannedMeal {
  slot: MealSlot;
  items: FoodPortion[];
  targetKcal: number;
  warning?: string;
}

export interface StrengthSet {
  exerciseId: number;
  sets: number;
  reps: number;
  weightKg?: number;
}

export interface DailyPlan {
  id?: number;
  date: string;
  budgetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  trendState: TrendState;
  trendText: string;
  advices: string[];
  dayType: DayType;
  dayTypeSource: DayTypeSource;
  dayTypeReason: string;
  cardio?: { exerciseTypeId: number; minutes: number; kcal: number };
  strength?: StrengthSet[];
  essentialIds: number[];
  meals: PlannedMeal[];
  generatedAt: string;
  basisWeightKg: number;
}

export interface MealLog {
  id?: number;
  date: string;
  slot: MealSlot;
  items: FoodPortion[];
  status: 'planned' | 'modified' | 'extra';
  loggedAt: string;
}

export interface WorkoutSchedule {
  id: 1;
  mode: 'auto' | 'fixed';
  cardioPerWeek: number;
  strengthPerWeek: number;
  restPerWeek: number;
  maxConsecutiveTraining: number;
  /** 固定星期模式：周一..周日 */
  fixedWeek: DayType[];
  cardioDefault: { exerciseTypeId: number; minutes: number };
  strengthDefault: StrengthSet[];
}

export interface EssentialItem {
  id?: number;
  name: string;
  note?: string;
  minutes?: number;
  dayTypes: DayType[];
  order: number;
  enabled: boolean;
}

export interface StrengthExercise {
  id?: number;
  name: string;
  bodyPart: BodyPart;
  defaultSets: number;
  defaultReps: number;
  weighted: boolean;
  builtin: boolean;
  hidden: boolean;
}

export interface WorkoutLog {
  id?: number;
  date: string;
  dayType: DayType;
  dayTypeSource: DayTypeSource;
  essentialsDone: { essentialId: number; at: string }[];
  cardio?: { exerciseTypeId: number; minutes: number; kcal: number };
  strengthDone: StrengthSet[];
  completed: boolean;
  completedAt?: string;
  backfilled: boolean;
}

export interface PeriodRecord {
  id?: number;
  start: string;
  end?: string;
}

export interface ExerciseType {
  id?: number;
  name: string;
  met: number;
  category: 'cardio' | 'strength';
}

/** 旧数据，保留用于迁移和备份。 */
export interface ShoppingList {
  id?: number;
  weekStart: string; // 周一
  createdAt: string;
}

export interface ShoppingItem {
  id?: number;
  listId: number;
  foodId: number;
  amount: number;
  unit: Unit;
  status: ShoppingStatus;
  note?: string;
}

export interface Settings {
  id: 1;
  lastBackupAt?: string;
  mealSplit: Record<MealSlot, number>;
  onboarded: boolean;
  ingredientsMigrated?: boolean;
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};
export const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const CATEGORY_LABEL: Record<FoodCategory, string> = {
  staple: '主食',
  protein: '蛋白',
  vegetable: '蔬菜',
  fruit: '水果',
  dairy: '奶制',
  snack: '零食',
  drink: '饮品',
  other: '其他',
};

export const UNIT_LABEL: Record<Unit, string> = {
  g: '克',
  ml: '毫升',
  piece: '个',
  serving: '份',
};

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  cardio: '有氧日',
  strength: '力量日',
  rest: '休息日',
};

export const BODY_PART_LABEL: Record<BodyPart, string> = {
  leg: '腿',
  glute: '臀',
  chest: '胸',
  back: '背',
  shoulder: '肩',
  core: '核心',
};

export const TREND_LABEL: Record<TrendState, string> = {
  insufficient: '数据不足',
  normal: '正常',
  tooFast: '过快',
  tooSlow: '过慢',
  plateau: '平台期',
  rebound: '反弹',
};
