import { useCallback, useState } from "react";
import { Activity, BarChart3, GitCompare } from "lucide-react";
import { AnalyticsPage } from "./components/Pages/AnalyticsPage";
import { SessionDetailPage } from "./components/Pages/SessionDetailPage";
import { SessionsPage } from "./components/Pages/SessionsPage";
import { VersionComparison } from "./components/VersionComparison";
import { GlobalSearch } from "./components/GlobalSearch";
import { ThemeToggle } from "./components/ui/theme-toggle";
import { TooltipProvider } from "./components/ui/tooltip";

type Page = "sessions" | "analytics" | "versions";

function Navigation({
  activePage,
  onLogoClick,
  onNavigate,
  onSessionSelect,
}: {
  activePage: Page;
  onLogoClick: () => void;
  onNavigate: (page: Page) => void;
  onSessionSelect: (sessionId: string) => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <button
            onClick={onLogoClick}
            className="flex items-center gap-2 transition-opacity hover:opacity-80 shrink-0"
          >
            <Activity className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold tracking-tight">Remi</span>
            <span className="ml-1 hidden text-xs font-medium text-muted-foreground sm:inline">
              Agent Observability
            </span>
          </button>

          <nav className="flex items-center gap-1">
            <button
              onClick={() => onNavigate("sessions")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activePage === "sessions"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              Sessions
            </button>
            <button
              onClick={() => onNavigate("analytics")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activePage === "analytics"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Analytics
            </button>
            <button
              onClick={() => onNavigate("versions")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activePage === "versions"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <GitCompare className="h-3.5 w-3.5" />
              Versions
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <GlobalSearch onSessionSelect={onSessionSelect} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function App() {
  const [activePage, setActivePage] = useState<Page>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleSelectSession = useCallback((sessionId: string, _name: string | null) => {
    setSelectedSessionId(sessionId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleLogoClick = useCallback(() => {
    handleBack();
    setActivePage("sessions");
  }, [handleBack]);

  const handleNavigate = useCallback(
    (page: Page) => {
      handleBack();
      setActivePage(page);
    },
    [handleBack]
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Navigation
          activePage={activePage}
          onLogoClick={handleLogoClick}
          onNavigate={handleNavigate}
          onSessionSelect={(sessionId) => {
            setSelectedSessionId(sessionId);
            setActivePage("sessions");
          }}
        />
        <main className="container py-6">
          {selectedSessionId ? (
            <SessionDetailPage
              sessionId={selectedSessionId}
              onBack={handleBack}
            />
          ) : activePage === "analytics" ? (
            <AnalyticsPage />
          ) : activePage === "versions" ? (
            <VersionComparison />
          ) : (
            <SessionsPage
              onSelectSession={handleSelectSession}
              selectedAgentId={selectedAgentId}
              onChangeAgentId={setSelectedAgentId}
            />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
