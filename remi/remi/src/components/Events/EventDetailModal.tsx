import {
  Clock,
  Hash,
  Wrench,
  Cpu,
  Tag,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { EventDetailContent } from "./EventDetailContent";
import type { Event } from "../../types/events";

interface EventDetailModalProps {
  event: Event | null;
  onClose: () => void;
}

const EVENT_TYPE_STYLES: Record<string, string> = {
  llm_start:       "bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700",
  llm_end:         "bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700",
  tool_start:      "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700",
  tool_end:        "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700",
  chain_start:     "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700",
  chain_end:       "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700",
  agent_action:    "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700",
  agent_finish:    "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700",
  retriever_start: "bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700",
  retriever_end:   "bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700",
  text:            "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700",
};

function badgeStyle(event_type: string): string {
  if (EVENT_TYPE_STYLES[event_type]) return EVENT_TYPE_STYLES[event_type];
  if (event_type.includes("error")) {
    return "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700";
  }
  return "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700";
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
      {children}
    </span>
  );
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const open = event !== null;

  const formattedDate = (() => {
    if (!event) return null;
    const ts = event.created_at || (typeof event.data.ts === "string" ? event.data.ts : null);
    if (!ts) return null;
    return new Date(ts).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="w-full max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton
      >
        {event && (
          <>
            {/* ── Fixed header ─────────────────────────────────── */}
            <DialogHeader className="shrink-0 border-b px-5 py-4 gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold ${badgeStyle(event.event_type)}`}>
                  <Tag className="h-3 w-3" />
                  {event.event_type}
                </span>

                {typeof event.data.duration_ms === "number" && (
                  <Chip className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300">
                    <Clock className="h-3 w-3" />
                    {event.data.duration_ms}ms
                  </Chip>
                )}

                {typeof (event.data.usage as { total_tokens?: number } | undefined)?.total_tokens === "number" && (
                  <Chip className="bg-muted border-border text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    {((event.data.usage as { total_tokens: number }).total_tokens).toLocaleString()} tokens
                  </Chip>
                )}

                {typeof event.data.tool === "string" && (
                  <Chip className="bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-300">
                    <Wrench className="h-3 w-3" />
                    {event.data.tool}
                  </Chip>
                )}

                {typeof event.data.model === "string" && (
                  <Chip className="bg-muted border-border text-muted-foreground">
                    <Cpu className="h-3 w-3" />
                    {event.data.model}
                  </Chip>
                )}
              </div>

              <DialogTitle className="sr-only">{event.event_type} event detail</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {formattedDate && <span>{formattedDate}</span>}
                  {event.session_id && (
                    <span>
                      Session:{" "}
                      <code className="bg-muted px-1 py-0.5 rounded font-mono">
                        {event.session_id}
                      </code>
                    </span>
                  )}
                  {typeof event.data.run_id === "string" && (
                    <span>
                      Run:{" "}
                      <code className="bg-muted px-1 py-0.5 rounded font-mono">
                        {String(event.data.run_id).slice(0, 14)}&hellip;
                      </code>
                    </span>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            {/* ── Scrollable body ───────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-5">
              <EventDetailContent event={event} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
