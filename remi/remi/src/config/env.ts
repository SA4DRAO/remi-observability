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
// ?key=<api-key> in the URL overrides the baked-in key (persisted so the demo
// link survives navigation). Lets one bundle serve both the admin dashboard
// and the public read-only demo.
const resolveApiKey = (): string => {
  if (typeof window === "undefined") return import.meta.env.VITE_API_KEY || "dev-key";
  const urlKey = new URLSearchParams(window.location.search).get("key");
  if (urlKey) localStorage.setItem("remi_api_key", urlKey);
  return (
    urlKey ||
    localStorage.getItem("remi_api_key") ||
    import.meta.env.VITE_API_KEY ||
    "dev-key"
  );
};

const getConfig = (): AppConfig => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiKey = resolveApiKey();
  const apiTimeout = parseInt(import.meta.env.VITE_API_TIMEOUT || "30000", 10);
  const debug = import.meta.env.VITE_ENABLE_DEBUG === "true";
  const env = getEnvironment();

  // When the app is served from a non-localhost origin (e.g. tailscale serve,
  // which proxies /api to the backend on the same hostname), default to
  // same-origin relative URLs so one bundle works locally and on the tailnet.
  const isLocalhost =
    typeof window === "undefined" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const defaultBaseUrl = isLocalhost ? "http://localhost:3100" : "";

  if (!apiUrl) {
    console.warn(`VITE_API_URL is not set. Using default: ${defaultBaseUrl || "same-origin"}`);
  }

  return {
    api: {
      baseUrl: apiUrl || defaultBaseUrl,
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
