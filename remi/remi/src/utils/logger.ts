/**
 * Logger Utility
 * Centralized logging with levels and debug mode control
 */

import { config } from "../config/env";

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * Format timestamp as ISO string
 */
const formatTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * Log message with level and optional data
 */
const log = (level: LogLevel, message: string, data?: unknown): void => {
  // Skip debug logs in production
  if (level === "debug" && !config.debug) {
    return;
  }

  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    data,
  };

  // Choose console method based on level
  const consoleMethods: Record<LogLevel, typeof console.log> = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const method = consoleMethods[level] || console.log;

  // Format message
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
  const formatted = `${prefix} ${message}`;

  // Log with data if provided
  if (data) {
    method(formatted, data);
  } else {
    method(formatted);
  }

};

/**
 * Logger object with typed methods
 */
export const logger = {
  /**
   * Info level logging
   */
  info: (message: string, data?: unknown): void => {
    log("info", message, data);
  },

  /**
   * Warning level logging
   */
  warn: (message: string, data?: unknown): void => {
    log("warn", message, data);
  },

  /**
   * Error level logging
   */
  error: (message: string, data?: unknown): void => {
    log("error", message, data);
  },

  /**
   * Debug level logging (only in dev mode)
   */
  debug: (message: string, data?: unknown): void => {
    log("debug", message, data);
  },
};
