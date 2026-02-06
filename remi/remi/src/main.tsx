import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Provider } from "react-redux";
import { store } from "./store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { config } from "./config/env";

/**
 * Application Entry Point
 * Renders the App component with React StrictMode
 */
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element with id 'root' not found in HTML");
}

const queryClient = new QueryClient();

// Sentry initialization (optional via VITE_SENTRY_DSN)
if (config.sentry?.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: config.sentry.tracesSampleRate,
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <Sentry.ErrorBoundary fallback={<p>Something went wrong.</p>}>
          <App />
        </Sentry.ErrorBoundary>
      </QueryClientProvider>
    </Provider>
  </StrictMode>
);
