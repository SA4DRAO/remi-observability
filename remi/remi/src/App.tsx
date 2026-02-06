import { useEffect } from "react";
import { ChatDisplay } from "./components/Chat/ChatDisplay";
import { ChatInput } from "./components/Input/ChatInput";
import { PageSelector } from "./components/PageSelector/PageSelector";
import { useChat } from "./hooks/useChat";
import { usePages } from "./hooks/usePages";
import { logger } from "./utils/logger";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { ThemeToggle } from "./components/ui/theme-toggle";

/**
 * App Component
 * Main application component that orchestrates all sub-components
 * Manages chat flow and page selection
 */
function App() {
  // Chat state management
  const {
    messages,
    loading,
    error,
    selectedPageId,
    setSelectedPageId,
    sendMessage,
  } = useChat("default");

  // Pages fetching with polling
  const { pages, loading: pagesLoading } = usePages(3000);

  // Initialize app on mount
  useEffect(() => {
    logger.info("App initialized successfully");
  }, []);

  // Convert PageInfo array to string array for display
  const pageIds = pages.map((p) => p.id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Remi Agent</h1>
            <p className="text-sm text-muted-foreground">AI-Powered Browser Automation</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <div className="container grid grid-cols-1 gap-4 py-4 md:grid-cols-12">
        {/* Sidebar with page selection */}
        <aside className="md:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session</CardTitle>
            </CardHeader>
            <CardContent>
              <PageSelector
                pages={pageIds}
                selectedPageId={selectedPageId}
                onSelectPage={setSelectedPageId}
                loading={pagesLoading}
              />
            </CardContent>
          </Card>
        </aside>

        {/* Main chat area */}
        <main className="md:col-span-9 flex flex-col gap-3">
          <Card className="flex h-[65vh] flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Conversation</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ChatDisplay messages={messages} loading={loading} />
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Card>
            <CardContent className="pt-6">
              <ChatInput onSend={sendMessage} loading={loading} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}

export default App;
