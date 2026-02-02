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
 * Returns the start of the week (Sunday at midnight) for a given date in local timezone.
 */
export function getStartOfWeek(date: Date): Date {
  const result = getStartOfDay(date);
  const dayOfWeek = result.getDay(); // 0 = Sunday, 6 = Saturday
  result.setDate(result.getDate() - dayOfWeek);
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

/**
 * Checks if a date falls within the current calendar week (Sunday to Saturday) in local timezone.
 * Returns true for dates from the start of this week up to now.
 */
export function isThisWeek(date: Date): boolean {
  const now = new Date();
  const startOfWeek = getStartOfWeek(now);
  return date >= startOfWeek && date <= now;
}
