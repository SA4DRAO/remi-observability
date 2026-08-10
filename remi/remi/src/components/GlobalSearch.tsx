/**
 * GlobalSearch — floating search bar for full-text search across span attributes.
 * Results link to the session that contains the matched span.
 */

import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useSpanSearch } from "../hooks/useSpanSearch";

interface GlobalSearchProps {
  onSessionSelect?: (sessionId: string) => void;
}

function useDebounce(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function GlobalSearch({ onSessionSelect }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(input, 350);
  const { results, isPending, isFetching } = useSpanSearch(debouncedQuery);

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleSelect(sessionId: string) {
    onSessionSelect?.(sessionId);
    setOpen(false);
    setInput("");
  }

  const loading = isPending || (isFetching && debouncedQuery.length >= 2);

  return (
    <>
      {/* Trigger button */}
      <button
        className="ctl h-7 text-muted-foreground hover:text-foreground"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        aria-label="Search spans (Ctrl+K)"
      >
        <Search className="h-3 w-3" />
        <span className="hidden sm:inline">Search spans, prompts…</span>
        <kbd className="hidden rounded border px-1 text-[10px] sm:inline">⌘K</kbd>
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div
            ref={panelRef}
            className="relative z-10 w-full max-w-xl rounded-xl border bg-background shadow-2xl"
          >
            {/* Input */}
            <div className="flex items-center gap-2 border-b px-4 py-3">
              {loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search prompts, completions, tool args…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {input && (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setInput("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {debouncedQuery.length < 2 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  Type at least 2 characters to search across span prompts and completions.
                </p>
              ) : results.length === 0 && !loading ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No results for <strong>{debouncedQuery}</strong>
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {results.map((r, i) => (
                    <li key={`${r.span_id}-${i}`}>
                      <button
                        className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => handleSelect(r.session_id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-mono text-xs font-medium">
                            {r.span_name}
                          </span>
                          {r.model && <span className="chip shrink-0">{r.model}</span>}
                          <span
                            className="chip chip-outline shrink-0"
                            style={{ color: r.status === "error" ? "var(--err)" : undefined }}
                          >
                            {r.status}
                          </span>
                        </div>
                        {r.snippet && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                            …{r.snippet}…
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70 truncate">
                          session: {r.session_id}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
