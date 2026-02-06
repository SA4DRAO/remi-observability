/**
 * Environment Configuration
 * Centralized management of environment variables
 * Type-safe configuration with defaults
 */

interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

interface AppConfig {
  api: ApiConfig;
  env: "development" | "production" | "staging";
  debug: boolean;
  sentry?: {
    dsn: string | null;
    tracesSampleRate: number;
    replaysSessionSampleRate: number;
    replaysOnErrorSampleRate: number;
  };
}

/**
 * Validate and parse environment
 */
const getEnvironment = (): "development" | "production" | "staging" => {
  const env = import.meta.env.VITE_ENV;
  if (env === "development" || env === "production" || env === "staging") {
    return env;
  }
  return "development";
};

/**
 * Get configuration from environment variables
 */
const getConfig = (): AppConfig => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiTimeout = parseInt(import.meta.env.VITE_API_TIMEOUT || "30000", 10);
  const debug = import.meta.env.VITE_ENABLE_DEBUG === "true";
  const env = getEnvironment();
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN || null;
  const sentryTracesRate = parseFloat(import.meta.env.VITE_SENTRY_TRACES || "0.1");
  const sentryReplaysSessionRate = parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_SESSION || "0.0");
  const sentryReplaysErrorRate = parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_ERROR || "1.0");

  // Validate required configuration
  if (!apiUrl) {
    console.warn(
      "VITE_API_URL is not set. Using default: http://localhost:3100"
    );
  }

  return {
    api: {
      baseUrl: apiUrl || "http://localhost:3100",
      timeout: isNaN(apiTimeout) ? 30000 : apiTimeout,
    },
    env,
    debug,
    sentry: {
      dsn: sentryDsn,
      tracesSampleRate: isNaN(sentryTracesRate) ? 0.1 : sentryTracesRate,
      replaysSessionSampleRate: isNaN(sentryReplaysSessionRate) ? 0.0 : sentryReplaysSessionRate,
      replaysOnErrorSampleRate: isNaN(sentryReplaysErrorRate) ? 1.0 : sentryReplaysErrorRate,
    },
  };
};

/**
 * Exported configuration object
 */
export const config = getConfig();
