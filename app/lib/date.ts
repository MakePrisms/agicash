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
 * Returns the start of the week for a given date in local timezone.
 * Uses the browser's locale to determine the first day of the week.
 * Falls back to Sunday if locale info is unavailable.
 */
export function getStartOfWeek(date: Date): Date {
  const locale = new Intl.Locale(navigator.language);
  // getWeekInfo().firstDay: 1 = Monday, 7 = Sunday
  const firstDayOfWeek = locale.getWeekInfo?.()?.firstDay ?? 7;

  const result = getStartOfDay(date);

  // getDay(): 0 = Sunday, 6 = Saturday
  // Convert firstDayOfWeek from ISO (1-7) to JS (0-6)
  const localeFirstDay = firstDayOfWeek === 7 ? 0 : firstDayOfWeek;
  const currentDay = result.getDay();

  // Calculate days to subtract to reach the start of week
  const daysToSubtract = (currentDay - localeFirstDay + 7) % 7;
  result.setDate(result.getDate() - daysToSubtract);

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
