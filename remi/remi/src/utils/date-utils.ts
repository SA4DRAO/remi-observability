/**
 * Date utility functions using dayjs
 */

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// Extend dayjs with relativeTime plugin
dayjs.extend(relativeTime);

/**
 * The backend emits UTC, but some columns (the version rollup's first_seen /
 * last_seen) serialize as a bare LocalDateTime with no zone suffix. Parsed
 * as-is those land in the viewer's local zone and read hours off. Stamp the Z
 * back on before parsing; anything already zoned is passed through untouched.
 */
function asUtc(date: Date | string): Date | string {
  if (typeof date !== "string") return date;
  return /(Z|[+-]\d{2}:?\d{2})$/.test(date) ? date : `${date}Z`;
}

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
export function formatDistanceToNow(date: Date | string): string {
  return dayjs(asUtc(date)).fromNow();
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string): string {
  return dayjs(asUtc(date)).format("MMM D, YYYY h:mm A");
}

/**
 * Format a date as ISO string
 */
export function formatISO(date: Date | string): string {
  return dayjs(date).toISOString();
}
