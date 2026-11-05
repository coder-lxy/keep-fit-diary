import type { EssentialItem, ExerciseType, FoodItem, StrengthExercise } from './types';

type F = Omit<FoodItem, 'id' | 'useCount' | 'hidden' | 'autoPlan' | 'builtin'>;

const g = (
  name: string,
  category: FoodItem['category'],
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  defaultAmount: number,
  slots: FoodItem['slots'],
  unit: FoodItem['unit'] = 'g',
): F => ({ name, category, unit, per: unit === 'g' || unit === 'ml' ? 100 : 1, kcal, protein, carbs, fat, defaultAmount, slots });

const ALL: FoodItem['slots'] = ['breakfast', 'lunch', 'dinner'];
const MAIN: FoodItem['slots'] = ['lunch', 'dinner'];
const BF: FoodItem['slots'] = ['breakfast'];
const SNACK: FoodItem['slots'] = ['snack'];
const BF_SNACK: FoodItem['slots'] = ['breakfast', 'snack'];

/** 预置约 80 种常见食材，数值来自《中国食物成分表》及常见包装标注，均为每 100 g / 100 ml 或每个 */
export const PRESET_FOODS: F[] = [
  // 主食
  g('米饭', 'staple', 116, 2.6, 25.9, 0.3, 150, MAIN),
  g('糙米饭', 'staple', 112, 2.6, 23.5, 0.9, 150, MAIN),
  g('燕麦片（干）', 'staple', 377, 15, 66.9, 6.7, 40, BF),
  g('全麦面包', 'staple', 246, 9, 45, 3.5, 60, BF),
  g('红薯（蒸）', 'staple', 90, 1.1, 20.7, 0.2, 150, ALL),
  g('紫薯（蒸）', 'staple', 82, 1.2, 18, 0.2, 150, ALL),
  g('玉米（鲜）', 'staple', 112, 4, 22.8, 1.2, 150, ALL),
  g('土豆（蒸）', 'staple', 77, 2, 17.2, 0.2, 150, MAIN),
  g('面条（煮）', 'staple', 110, 3.9, 22.8, 0.4, 150, MAIN),
  g('荞麦面（煮）', 'staple', 110, 4, 21, 0.7, 150, MAIN),
  g('馒头', 'staple', 223, 7, 47, 1.1, 80, BF),
  g('山药（蒸）', 'staple', 57, 1.9, 12.4, 0.2, 150, MAIN),
  g('藜麦（熟）', 'staple', 120, 4.4, 21.3, 1.9, 150, MAIN),
  g('全麦意面（熟）', 'staple', 124, 5, 25, 0.8, 150, MAIN),
  // 蛋白
  g('鸡胸肉（生）', 'protein', 118, 23.3, 0.6, 1.9, 120, MAIN),
  g('鸡腿肉（去皮）', 'protein', 150, 20, 0, 7.5, 120, MAIN),
  g('鸡蛋', 'protein', 72, 6.3, 0.4, 5, 1, ALL, 'piece'),
  g('蛋白（蛋清）', 'protein', 17, 3.6, 0.2, 0, 2, BF, 'piece'),
  g('瘦牛肉', 'protein', 106, 20.2, 1.2, 2.3, 100, MAIN),
  g('瘦猪肉', 'protein', 143, 20.3, 1.5, 6.2, 100, MAIN),
  g('猪里脊', 'protein', 155, 20.2, 0.7, 7.9, 100, MAIN),
  g('虾', 'protein', 93, 18.6, 2.8, 0.8, 120, MAIN),
  g('三文鱼', 'protein', 139, 17.2, 0, 7.8, 100, MAIN),
  g('鳕鱼', 'protein', 88, 20.4, 0.5, 0.5, 120, MAIN),
  g('巴沙鱼（龙利鱼柳）', 'protein', 90, 17, 0, 2, 120, MAIN),
  g('鲈鱼', 'protein', 105, 18.6, 0, 3.4, 120, MAIN),
  g('带鱼', 'protein', 127, 17.7, 3.1, 4.9, 100, MAIN),
  g('金枪鱼罐头（水浸）', 'protein', 99, 23, 0, 0.5, 80, ALL),
  g('北豆腐', 'protein', 116, 12.2, 2, 4.8, 150, MAIN),
  g('嫩豆腐', 'protein', 57, 6.2, 2.4, 2.5, 200, MAIN),
  g('豆腐干', 'protein', 140, 16.2, 3, 7, 80, MAIN),
  g('毛豆', 'protein', 131, 13.1, 10.5, 5, 100, MAIN),
  g('鹰嘴豆（熟）', 'protein', 164, 8.9, 27.4, 2.6, 80, MAIN),
  g('乳清蛋白粉', 'protein', 380, 75, 10, 5, 30, BF_SNACK),
  // 蔬菜
  g('西兰花', 'vegetable', 36, 4.1, 4.3, 0.6, 150, MAIN),
  g('菠菜', 'vegetable', 28, 2.6, 4.5, 0.3, 150, MAIN),
  g('生菜', 'vegetable', 13, 1.3, 2, 0.3, 100, ALL),
  g('番茄', 'vegetable', 20, 0.9, 4, 0.2, 150, ALL),
  g('黄瓜', 'vegetable', 16, 0.8, 2.9, 0.2, 150, ALL),
  g('胡萝卜', 'vegetable', 39, 1, 8.8, 0.2, 100, MAIN),
  g('青椒', 'vegetable', 22, 1, 5.4, 0.2, 100, MAIN),
  g('大白菜', 'vegetable', 20, 1.5, 3.2, 0.1, 150, MAIN),
  g('娃娃菜', 'vegetable', 13, 1.9, 2, 0.1, 150, MAIN),
  g('芹菜', 'vegetable', 22, 1.2, 4.5, 0.2, 100, MAIN),
  g('油麦菜', 'vegetable', 15, 1.4, 2.1, 0.4, 150, MAIN),
  g('平菇', 'vegetable', 24, 1.9, 4.6, 0.3, 100, MAIN),
  g('香菇（鲜）', 'vegetable', 26, 2.2, 5.2, 0.3, 80, MAIN),
  g('金针菇', 'vegetable', 32, 2.4, 6, 0.4, 100, MAIN),
  g('绿豆芽', 'vegetable', 18, 2.1, 2.9, 0.1, 100, MAIN),
  g('茄子', 'vegetable', 23, 1.1, 4.9, 0.2, 150, MAIN),
  g('冬瓜', 'vegetable', 12, 0.4, 2.6, 0.2, 200, MAIN),
  g('西葫芦', 'vegetable', 19, 0.8, 3.8, 0.2, 150, MAIN),
  g('芦笋', 'vegetable', 19, 1.4, 3, 0.1, 100, MAIN),
  g('秋葵', 'vegetable', 37, 2, 7.5, 0.1, 100, MAIN),
  g('海带（鲜）', 'vegetable', 17, 1.2, 2.1, 0.1, 100, MAIN),
  g('木耳（水发）', 'vegetable', 27, 1.5, 6, 0.2, 80, MAIN),
  g('紫甘蓝', 'vegetable', 25, 1.2, 6.2, 0.2, 100, MAIN),
  g('洋葱', 'vegetable', 40, 1.1, 9, 0.2, 80, MAIN),
  g('四季豆', 'vegetable', 30, 2, 5.7, 0.4, 120, MAIN),
  g('南瓜', 'vegetable', 23, 0.7, 5.3, 0.1, 150, MAIN),
  // 水果
  g('苹果', 'fruit', 54, 0.2, 13.7, 0.2, 200, BF_SNACK),
  g('香蕉', 'fruit', 93, 1.4, 22, 0.2, 120, BF_SNACK),
  g('橙子', 'fruit', 48, 0.8, 11.1, 0.2, 200, SNACK),
  g('蓝莓', 'fruit', 57, 0.7, 14.5, 0.3, 100, BF_SNACK),
  g('草莓', 'fruit', 32, 1, 7.1, 0.2, 150, BF_SNACK),
  g('猕猴桃', 'fruit', 61, 0.8, 14.5, 0.6, 100, SNACK),
  g('葡萄', 'fruit', 45, 0.5, 10.3, 0.2, 150, SNACK),
  g('西瓜', 'fruit', 31, 0.6, 7.9, 0.1, 300, SNACK),
  g('梨', 'fruit', 51, 0.4, 13.3, 0.2, 200, SNACK),
  g('桃', 'fruit', 51, 0.9, 12.2, 0.1, 200, SNACK),
  g('柚子', 'fruit', 42, 0.8, 9.5, 0.2, 200, SNACK),
  g('圣女果', 'fruit', 25, 1, 5.8, 0.2, 150, BF_SNACK),
  g('火龙果', 'fruit', 55, 1.1, 13.3, 0.2, 200, SNACK),
  // 奶制
  g('全脂牛奶', 'dairy', 65, 3.3, 5, 3.6, 250, BF_SNACK, 'ml'),
  g('脱脂牛奶', 'dairy', 35, 3.4, 5, 0.1, 250, BF_SNACK, 'ml'),
  g('无糖酸奶', 'dairy', 72, 3.2, 6, 3.8, 150, BF_SNACK),
  g('无糖希腊酸奶', 'dairy', 97, 9, 3.6, 5, 150, BF_SNACK),
  g('无糖豆浆', 'dairy', 31, 3, 1.2, 1.6, 250, BF_SNACK, 'ml'),
  // 零食
  g('混合坚果', 'snack', 600, 20, 20, 50, 20, SNACK),
  g('核桃', 'snack', 654, 14.9, 19.1, 58.8, 15, SNACK),
  g('巴旦木', 'snack', 579, 21, 22, 50, 15, SNACK),
  g('黑巧克力（85%）', 'snack', 590, 10, 30, 45, 15, SNACK),
  // 饮品 / 其他
  g('黑咖啡', 'drink', 2, 0.2, 0, 0, 250, BF_SNACK, 'ml'),
  g('食用油', 'other', 899, 0, 0, 99.9, 10, MAIN),
];

export const PRESET_EXERCISE_TYPES: Omit<ExerciseType, 'id'>[] = [
  { name: '快走', met: 4.3, category: 'cardio' },
  { name: '慢跑', met: 7.0, category: 'cardio' },
  { name: '骑行', met: 6.8, category: 'cardio' },
  { name: '椭圆机', met: 5.0, category: 'cardio' },
  { name: '游泳', met: 6.0, category: 'cardio' },
  { name: '跳绳', met: 11.0, category: 'cardio' },
  { name: 'HIIT', met: 8.0, category: 'cardio' },
  { name: '力量训练', met: 5.0, category: 'strength' },
];

export const PRESET_STRENGTH: Omit<StrengthExercise, 'id'>[] = [
  { name: '深蹲', bodyPart: 'leg', defaultSets: 3, defaultReps: 15, weighted: false, builtin: true, hidden: false },
  { name: '箭步蹲', bodyPart: 'leg', defaultSets: 3, defaultReps: 12, weighted: false, builtin: true, hidden: false },
  { name: '臀桥', bodyPart: 'glute', defaultSets: 3, defaultReps: 15, weighted: false, builtin: true, hidden: false },
  { name: '俯卧撑', bodyPart: 'chest', defaultSets: 3, defaultReps: 10, weighted: false, builtin: true, hidden: false },
  { name: '哑铃卧推', bodyPart: 'chest', defaultSets: 3, defaultReps: 12, weighted: true, builtin: true, hidden: false },
  { name: '哑铃划船', bodyPart: 'back', defaultSets: 3, defaultReps: 12, weighted: true, builtin: true, hidden: false },
  { name: '哑铃肩推', bodyPart: 'shoulder', defaultSets: 3, defaultReps: 12, weighted: true, builtin: true, hidden: false },
  { name: '硬拉', bodyPart: 'back', defaultSets: 3, defaultReps: 10, weighted: true, builtin: true, hidden: false },
  { name: '平板支撑（秒）', bodyPart: 'core', defaultSets: 3, defaultReps: 45, weighted: false, builtin: true, hidden: false },
  { name: '卷腹', bodyPart: 'core', defaultSets: 3, defaultReps: 15, weighted: false, builtin: true, hidden: false },
];

export const PRESET_ESSENTIALS: Omit<EssentialItem, 'id'>[] = [
  { name: '八段锦', note: '一遍约 12 分钟', minutes: 12, dayTypes: ['cardio', 'strength'], order: 1, enabled: true },
];
