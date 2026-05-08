/**
 * Date utilities for timezone-aware calendar day comparisons.
 * All functions operate in the user's local timezone.
 */

/**
 * Returns the start of the day (midnight) for a given date in local timezone.
 */
export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns midnight (start of day) for the day `n` days before today, in local timezone.
 * `n = 0` is the start of today, `n = 1` is the start of yesterday, etc.
 */
export function getStartOfDayNDaysAgo(n: number): Date {
  const result = getStartOfDay(new Date());
  result.setDate(result.getDate() - n);
  return result;
}

/**
 * Checks if two dates are on the same calendar day in local timezone.
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Checks if a date is today in local timezone.
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Checks if a date is yesterday in local timezone.
 */
export function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday);
}
