/** 有氧消耗 = MET × 体重 kg × 小时 */
export function cardioKcal(met: number, weightKg: number, minutes: number): number {
  return Math.round(met * weightKg * (minutes / 60));
}
