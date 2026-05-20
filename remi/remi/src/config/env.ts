/**
 * Environment Configuration
 * Centralized management of environment variables
 * Type-safe configuration with defaults
 */

interface ApiConfig {
  baseUrl: string;
  timeout: number;
  apiKey: string;
}

interface AppConfig {
  api: ApiConfig;
  env: "development" | "production" | "staging";
  debug: boolean;
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
  const apiKey = import.meta.env.VITE_API_KEY || "dev-key";
  const apiTimeout = parseInt(import.meta.env.VITE_API_TIMEOUT || "30000", 10);
  const debug = import.meta.env.VITE_ENABLE_DEBUG === "true";
  const env = getEnvironment();

  if (!apiUrl) {
    console.warn("VITE_API_URL is not set. Using default: http://localhost:3100");
  }

  return {
    api: {
      baseUrl: apiUrl || "http://localhost:3100",
      timeout: isNaN(apiTimeout) ? 30000 : apiTimeout,
      apiKey,
    },
    env,
    debug,
  };
};

/**
 * Exported configuration object
 */
export const config = getConfig();
