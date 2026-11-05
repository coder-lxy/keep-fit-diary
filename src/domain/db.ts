import Dexie, { type EntityTable } from 'dexie';
import { RULES, WEEK_DEFAULTS } from './constants';
import { nowIso, today, weekStartOf } from './dates';
import { PRESET_ESSENTIALS, PRESET_EXERCISE_TYPES, PRESET_FOODS, PRESET_STRENGTH } from './seed';
import type {
  BodyRecord,
  DailyPlan,
  EssentialItem,
  ExerciseType,
  FoodItem,
  MealLog,
  PeriodRecord,
  Settings,
  ShoppingItem,
  ShoppingList,
  StrengthExercise,
  UserProfile,
  WorkoutLog,
  WorkoutSchedule,
} from './types';

export class FatLossDB extends Dexie {
  profile!: EntityTable<UserProfile, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  bodyRecords!: EntityTable<BodyRecord, 'id'>;
  foods!: EntityTable<FoodItem, 'id'>;
  plans!: EntityTable<DailyPlan, 'id'>;
  mealLogs!: EntityTable<MealLog, 'id'>;
  schedule!: EntityTable<WorkoutSchedule, 'id'>;
  essentials!: EntityTable<EssentialItem, 'id'>;
  strengthExercises!: EntityTable<StrengthExercise, 'id'>;
  workoutLogs!: EntityTable<WorkoutLog, 'id'>;
  periods!: EntityTable<PeriodRecord, 'id'>;
  exerciseTypes!: EntityTable<ExerciseType, 'id'>;
  shoppingLists!: EntityTable<ShoppingList, 'id'>;
  shoppingItems!: EntityTable<ShoppingItem, 'id'>;

  constructor() {
    super('fatloss-diary');
    this.version(1).stores({
      profile: 'id',
      settings: 'id',
      bodyRecords: '++id, date, [date+isDaily]',
      foods: '++id, name, category, hidden',
      plans: '++id, &date',
      mealLogs: '++id, date, [date+slot]',
      schedule: 'id',
      essentials: '++id, order',
      strengthExercises: '++id, name',
      workoutLogs: '++id, &date',
      periods: '++id, start',
      exerciseTypes: '++id, name',
      shoppingLists: '++id, &weekStart',
      shoppingItems: '++id, listId, foodId, [listId+status]',
    });
  }
}

export const db = new FatLossDB();

export const TABLE_NAMES = [
  'profile',
  'settings',
  'bodyRecords',
  'foods',
  'plans',
  'mealLogs',
  'schedule',
  'essentials',
  'strengthExercises',
  'workoutLogs',
  'periods',
  'exerciseTypes',
  'shoppingLists',
  'shoppingItems',
] as const;

export function defaultSchedule(cardioTypeId: number): WorkoutSchedule {
  return {
    id: 1,
    mode: 'auto',
    cardioPerWeek: WEEK_DEFAULTS.cardioPerWeek,
    strengthPerWeek: WEEK_DEFAULTS.strengthPerWeek,
    restPerWeek: WEEK_DEFAULTS.restPerWeek,
    maxConsecutiveTraining: WEEK_DEFAULTS.maxConsecutiveTraining,
    fixedWeek: ['cardio', 'strength', 'cardio', 'strength', 'cardio', 'strength', 'rest'],
    cardioDefault: { exerciseTypeId: cardioTypeId, minutes: WEEK_DEFAULTS.cardioMinutes },
    strengthDefault: [],
  };
}

export function defaultSettings(): Settings {
  return { id: 1, mealSplit: { ...RULES.mealSplit }, onboarded: false };
}

/** 首次启动：写入预置运动项目、动作库、必练项、设置；食物库由引导页按勾选导入 */
export async function ensureSeeded(): Promise<void> {
  await db.transaction(
    'rw',
    [db.settings, db.exerciseTypes, db.strengthExercises, db.essentials, db.schedule],
    async () => {
      if (!(await db.settings.get(1))) await db.settings.put(defaultSettings());
      if ((await db.exerciseTypes.count()) === 0) {
        await db.exerciseTypes.bulkAdd(PRESET_EXERCISE_TYPES as ExerciseType[]);
      }
      if ((await db.strengthExercises.count()) === 0) {
        await db.strengthExercises.bulkAdd(PRESET_STRENGTH as StrengthExercise[]);
      }
      if ((await db.essentials.count()) === 0) {
        await db.essentials.bulkAdd(PRESET_ESSENTIALS as EssentialItem[]);
      }
      if (!(await db.schedule.get(1))) {
        const walk = await db.exerciseTypes.where('name').equals('快走').first();
        const sched = defaultSchedule(walk?.id ?? 1);
        const firstThree = await db.strengthExercises.limit(4).toArray();
        sched.strengthDefault = firstThree.map((e) => ({
          exerciseId: e.id!,
          sets: e.defaultSets,
          reps: e.defaultReps,
        }));
        await db.schedule.put(sched);
      }
    },
  );
  await migrateIngredients();
}

/** 兼容旧购物清单及旧备份：按每种食材最近一次的状态带入现有食材。 */
async function migrateIngredients(): Promise<void> {
  await db.transaction('rw', [db.foods, db.settings, db.shoppingLists, db.shoppingItems], async () => {
    const settings = await db.settings.get(1);
    if (settings?.ingredientsMigrated) return;
    const lists = await db.shoppingLists.where('weekStart').belowOrEqual(weekStartOf(today())).sortBy('weekStart');
    const latestStatus = new Map<number, ShoppingItem['status']>();
    for (const list of lists) {
      for (const item of await db.shoppingItems.where('listId').equals(list.id!).toArray()) {
        latestStatus.set(item.foodId, item.status);
      }
    }
    await db.foods.toCollection().modify((food) => {
      if (food.inStock === undefined) food.inStock = latestStatus.get(food.id!) === 'bought';
    });
    if (settings) await db.settings.update(1, { ingredientsMigrated: true });
  });
}

/** 导入预置食物（按名称去重） */
export async function importPresetFoods(names?: string[]): Promise<number> {
  const existing = new Set((await db.foods.toArray()).map((f) => f.name));
  const toAdd = PRESET_FOODS.filter(
    (f) => !existing.has(f.name) && (!names || names.includes(f.name)),
  ).map<FoodItem>((f) => ({ ...f, autoPlan: true, inStock: false, useCount: 0, hidden: false, builtin: true }));
  if (toAdd.length) await db.foods.bulkAdd(toAdd);
  return toAdd.length;
}

export interface BackupFile {
  app: 'fatloss-diary';
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  await db.settings.update(1, { lastBackupAt: nowIso() });
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) tables[name] = await db.table(name).toArray();
  return { app: 'fatloss-diary', version: 1, exportedAt: nowIso(), tables };
}

export async function importAll(file: BackupFile): Promise<void> {
  if (file.app !== 'fatloss-diary') throw new Error('不是减脂日记的备份文件');
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear();
      const rows = file.tables[name];
      if (rows?.length) await db.table(name).bulkAdd(rows);
    }
    await migrateIngredients();
  });
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
  });
}
