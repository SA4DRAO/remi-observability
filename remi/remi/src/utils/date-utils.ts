/**
 * Date utility functions using dayjs
 */

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// Extend dayjs with relativeTime plugin
dayjs.extend(relativeTime);

/**
 * Format a date as relative time (e.g., "2 minutes ago")
 */
export function formatDistanceToNow(date: Date | string): string {
  return dayjs(date).fromNow();
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string): string {
  return dayjs(date).format("MMM D, YYYY h:mm A");
}

/**
 * Format a date as ISO string
 */
export function formatISO(date: Date | string): string {
  return dayjs(date).toISOString();
}
