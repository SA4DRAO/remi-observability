import { useCallback, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { DEMO_MODE, demoGeneratedAt } from "./utils/demo-data";
import { AnalyticsPage } from "./components/Pages/AnalyticsPage";
import { OverviewPage } from "./components/Pages/OverviewPage";
import { SessionsPage } from "./components/Pages/SessionsPage";
import { TracePage } from "./components/Pages/TracePage";
import { VersionComparison } from "./components/VersionComparison";
import { GlobalSearch } from "./components/GlobalSearch";
import { ScopeBar } from "./components/ScopeBar";
import { DEFAULT_SCOPE, dateFrom, type Scope } from "./lib/scope";
import { useAnalytics } from "./hooks/useAnalytics";
import { useTheme } from "./hooks/useTheme";
import type { AttentionItem } from "./utils/attention";

type Page = "overview" | "sessions" | "trace" | "analytics" | "versions";

const NAV: Array<[Page, string]> = [
  ["overview", "Overview"],
  ["sessions", "Sessions"],
  ["trace", "Trace"],
  ["analytics", "Analytics"],
  ["versions", "Versions"],
];

function Logo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

/** Static-snapshot notice. Says what is and isn't real so nobody mistakes the
 *  frozen data for a live system, and points at the repo for running it. */
function DemoBanner() {
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    demoGeneratedAt().then(setGeneratedAt).catch(() => setGeneratedAt(null));
  }, []);

  return (
    <div className="border-b bg-subtle">
      <div className="shell flex h-8 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="chip" style={{ borderColor: "var(--info)", color: "var(--info)" }}>
          demo
        </span>
        <span className="text-muted-foreground">
          Static snapshot of a real Remi instance
          {generatedAt ? ` captured ${generatedAt}` : ""} — every view is live, the data is frozen.
        </span>
        <a
          className="ml-auto underline underline-offset-2 hover:text-foreground"
          href="https://github.com/SA4DRAO/remi-observability"
          rel="noreferrer"
          target="_blank"
        >
          Run it yourself →
        </a>
      </div>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);
  const { isDark, toggleTheme } = useTheme();

  // One unscoped analytics read powers the agent dropdown and the freshness
  // clock. Pages issue their own agent-scoped query; TanStack dedupes the rest.
  const { analytics, isFetching, dataUpdatedAt, refetch } = useAnalytics({
    date_from: dateFrom(scope.days),
    days: scope.days,
  });

  const openSession = useCallback((id: string) => {
    setSessionId(id);
    setPage("trace");
  }, []);

  const navigate = useCallback((next: Page) => {
    if (next !== "trace") setSessionId(null);
    setPage(next);
  }, []);

  const follow = useCallback(
    (item: AttentionItem) => {
      if (item.agent) setScope((s) => ({ ...s, agent: item.agent as string }));
      if (item.sessionId) {
        openSession(item.sessionId);
        return;
      }
      if (item.target === "sessions" && item.severity === "err") {
        setScope((s) => ({ ...s, status: "error" }));
      }
      navigate(item.target === "trace" ? "sessions" : item.target);
    },
    [navigate, openSession],
  );

  const agents = useMemo(() => (analytics?.agents ?? []).map((a) => a.agent).sort(), [analytics]);

  const isTrace = page === "trace" && sessionId !== null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="shell flex h-12 items-center gap-7">
          <button
            onClick={() => navigate("overview")}
            className="flex shrink-0 items-center gap-[7px]"
            aria-label="Remi overview"
          >
            <Logo />
            <span className="text-sm font-bold tracking-tight">Remi</span>
          </button>

          <nav className="flex h-12 items-stretch gap-0.5">
            {NAV.map(([key, label]) => {
              const active = page === key;
              return (
                <button
                  key={key}
                  onClick={() => navigate(key)}
                  disabled={key === "trace" && !sessionId}
                  className="px-3 text-xs disabled:opacity-40"
                  style={{
                    color: active ? "var(--foreground)" : "var(--muted-foreground)",
                    fontWeight: active ? 700 : 500,
                    boxShadow: active ? "inset 0 -2px 0 0 var(--foreground)" : undefined,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch onSessionSelect={openSession} />
            <span className="hidden items-center gap-1.5 rounded-md border px-2.5 text-[11px] text-muted-foreground sm:inline-flex sm:h-7">
              <span className="dot" style={{ background: "var(--ok)", width: 5, height: 5 }} />
              {analytics?.agents[0] ? "live" : "idle"}
            </span>
            <button
              className="ctl h-7 w-7 justify-center px-0"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {DEMO_MODE && <DemoBanner />}

      {!isTrace && (
        <ScopeBar
          scope={scope}
          onChange={setScope}
          agents={agents}
          showStatus={page === "overview" || page === "sessions"}
          updatedAt={dataUpdatedAt}
          isFetching={isFetching}
          onRefresh={() => void refetch()}
        />
      )}

      <main className={isTrace ? "" : "shell pb-14 pt-6"}>
        {isTrace ? (
          <TracePage sessionId={sessionId} onBack={() => navigate("sessions")} />
        ) : page === "sessions" ? (
          <SessionsPage scope={scope} onSelectSession={openSession} />
        ) : page === "analytics" ? (
          <AnalyticsPage scope={scope} />
        ) : page === "versions" ? (
          <VersionComparison scope={scope} />
        ) : (
          <OverviewPage
            scope={scope}
            onFollow={follow}
            onSelectSession={openSession}
            onNavigate={navigate}
          />
        )}
      </main>
    </div>
  );
}

export default App;
