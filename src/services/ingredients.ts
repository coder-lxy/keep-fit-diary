import { db } from '../domain/db';
import type { FoodItem } from '../domain/types';

/** 现有食材不按周清空；食物库仍保留全部食物用于手动记餐。 */
export function availableIngredients(foods: FoodItem[]): FoodItem[] {
  return foods.filter((food) => food.inStock && !food.hidden);
}

export async function setIngredientInStock(foodId: number, inStock: boolean): Promise<void> {
  const updated = await db.foods.update(foodId, { inStock });
  if (!updated) throw new Error('食材已不存在，请刷新后重试');
}
