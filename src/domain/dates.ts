import dayjs from 'dayjs';

export const DATE = 'YYYY-MM-DD';

export function today(): string {
  return dayjs().format(DATE);
}

export function nowTime(): string {
  return dayjs().format('HH:mm');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(date: string, n: number): string {
  return dayjs(date).add(n, 'day').format(DATE);
}

export function diffDays(a: string, b: string): number {
  return dayjs(a).diff(dayjs(b), 'day');
}

/** 周一为一周开始 */
export function weekStartOf(date: string): string {
  const d = dayjs(date);
  const dow = (d.day() + 6) % 7; // 周一=0
  return d.subtract(dow, 'day').format(DATE);
}

/** 0 = 周一 … 6 = 周日 */
export function weekdayIndex(date: string): number {
  return (dayjs(date).day() + 6) % 7;
}

export function ageAt(birthDate: string, date: string): number {
  return dayjs(date).diff(dayjs(birthDate), 'year');
}

export function formatCn(date: string): string {
  return dayjs(date).format('M月D日');
}

export const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

export function isBetween(date: string, start: string, end?: string): boolean {
  return date >= start && (!end || date <= end);
}
