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
  debug: boolean;
}

/**
 * Get configuration from environment variables
 */
const isLocalhost = (): boolean =>
  typeof window === "undefined" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

// ?key=<api-key> in the URL overrides everything (persisted so the demo link
// survives navigation) — that's what serves the public read-only demo.
//
// Otherwise: a baked-in key is a DEV-ONLY convenience. It ships inside the JS
// bundle, so anyone loading the page can read it; on a hosted origin we return
// "" instead and send no Authorization header at all. There the reverse proxy
// has already authenticated the user and the backend resolves them from the
// forwarded email, so the browser never holds a credential.
const resolveApiKey = (): string => {
  if (typeof window === "undefined") return "";
  const urlKey = new URLSearchParams(window.location.search).get("key");
  if (urlKey) localStorage.setItem("remi_api_key", urlKey);
  const stored = urlKey || localStorage.getItem("remi_api_key");
  if (stored) return stored;
  return isLocalhost() ? import.meta.env.VITE_API_KEY || "dev-key" : "";
};

const getConfig = (): AppConfig => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiKey = resolveApiKey();
  const apiTimeout = parseInt(import.meta.env.VITE_API_TIMEOUT || "30000", 10);
  const debug = import.meta.env.VITE_ENABLE_DEBUG === "true";

  // When the app is served from a non-localhost origin (e.g. Caddy or tailscale
  // serve, which proxy /api to the backend on the same hostname), default to
  // same-origin relative URLs so one bundle works locally and when hosted.
  const defaultBaseUrl = isLocalhost() ? "http://localhost:3100" : "";

  if (!apiUrl) {
    console.warn(`VITE_API_URL is not set. Using default: ${defaultBaseUrl || "same-origin"}`);
  }

  return {
    api: {
      baseUrl: apiUrl || defaultBaseUrl,
      timeout: isNaN(apiTimeout) ? 30000 : apiTimeout,
      apiKey,
    },
    debug,
  };
};

/**
 * Exported configuration object
 */
export const config = getConfig();
