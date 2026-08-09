/**
 * Calendar-date helpers.
 *
 * These exist because `new Date().toISOString().split('T')[0]` is not "today".
 * toISOString() serializes in UTC, so it answers "what is the date in
 * Greenwich right now", which is not the question any caller here is asking.
 * Two ways that goes wrong:
 *
 *   - West of UTC, after local evening: at 21:30 in New York the UTC date has
 *     already rolled over, so "today" comes back as tomorrow.
 *   - East of UTC: `new Date(y, m, 1)` builds local midnight, which is still
 *     the *previous* day in UTC, so start_of_month comes back as the last day
 *     of the prior month.
 *
 * Everything here works in the host's local timezone, which is what a merchant
 * means by "today" when they ask for a report.
 */

/** Format a Date as YYYY-MM-DD using its local calendar fields. */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's calendar date in the host's local timezone, as YYYY-MM-DD. */
export function todayLocal(): string {
  return formatLocalDate(new Date());
}
