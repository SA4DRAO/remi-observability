import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { formatDistanceToNow } from "../../utils/date-utils";
import type { Event } from "../../types/events";

interface EventListItemProps {
  event: Event;
  onClick: () => void;
  /** Visual nesting depth (0 = root). Supplied by buildEventTree. */
  depth?: number;
}

export function EventListItem({ event, onClick, depth = 0 }: EventListItemProps) {
  const otelSpanCategory =
    event.event_type === "otel_span" && typeof event.data.span_category === "string"
      ? event.data.span_category
      : null;
  const otelSpanName =
    event.event_type === "otel_span" && typeof event.data.span_name === "string"
      ? event.data.span_name
      : null;
  const otelModel =
    event.event_type === "otel_span" && typeof event.data.model === "string"
      ? event.data.model
      : null;
  const otelToolName =
    event.event_type === "otel_span" && typeof event.data.tool_name === "string"
      ? event.data.tool_name
      : null;

  const getEventColor = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type === "otel_span") {
      if (event.data.status_code === 2) return "destructive";
      if (otelSpanCategory === "llm") return "default";
      if (otelSpanCategory === "tool" || otelSpanCategory === "chain") return "secondary";
      return "outline";
    }
    if (type.includes("error")) return "destructive";
    if (type.includes("llm") || type.includes("chat")) return "default";
    if (type.includes("tool")) return "secondary";
    if (type.includes("agent")) return "secondary";
    if (type.includes("chain")) return "secondary";
    if (type.includes("retriever")) return "secondary";
    return "outline";
  };

  const getEventEmoji = (type: string) => {
    if (type === "otel_span") {
      if (event.data.status_code === 2) return "❌";
      if (otelSpanCategory === "llm") return "🧠";
      if (otelSpanCategory === "tool") return "🔨";
      if (otelSpanCategory === "chain") return "⛓️";
      if (otelSpanCategory === "root") return "🎯";
      return "📝";
    }

    // Error events
    if (type.includes("error")) return "❌";
    
    // LLM events
    if (type === "llm_start") return "🚀";
    if (type === "llm_end") return "✅";
    if (type === "llm_new_token") return "📝";
    if (type.includes("chat")) return "💬";
    
    // Tool events
    if (type === "tool_start") return "🔨";
    if (type === "tool_end") return "✔️";
    
    // Agent events
    if (type === "agent_action") return "🤖";
    if (type === "agent_finish") return "🎯";
    
    // Chain events
    if (type === "chain_start") return "⛓️";
    if (type === "chain_end") return "✅";
    
    // Retriever events
    if (type === "retriever_start") return "🔍";
    if (type === "retriever_end") return "📄";
    
    // Text event
    if (type === "text") return "📝";
    
    return "📝";
  };

  const getDurationDisplay = () => {
    if (typeof event.data.duration_ms === "number") {
      return `${event.data.duration_ms}ms`;
    }
    return null;
  };

  const getTokenCount = () => {
    if (event.data.usage && typeof event.data.usage === "object") {
      const usage = event.data.usage as any;
      if (typeof usage.total_tokens === "number") {
        return usage.total_tokens;
      }
    }
    return null;
  };

  const getTimestamp = () => {
    if (event.created_at) {
      return new Date(event.created_at);
    }

    if (event.data.ts && typeof event.data.ts === "string") {
      return new Date(event.data.ts);
    }

    return null;
  };

  const getEventLabel = () => {
    if (event.event_type === "otel_span") {
      return otelSpanCategory ? `otel ${otelSpanCategory}` : "otel span";
    }
    return event.event_type;
  };

  const getSecondaryInfo = () => {
    if (event.event_type === "otel_span") {
      const parts: string[] = [];

      if (otelSpanName) {
        parts.push(otelSpanName);
      }
      if (otelModel && otelModel !== otelSpanName) {
        parts.push(`Model: ${otelModel}`);
      }
      if (otelToolName && otelToolName !== otelSpanName) {
        parts.push(`Tool: ${otelToolName}`);
      }

      return parts.length > 0 ? parts.join(" · ") : null;
    }

    // Show different info based on event type
    if (event.event_type === "agent_action" && event.data.tool && typeof event.data.tool === "string") {
      return `Tool: ${event.data.tool}`;
    }
    if (event.event_type === "chain_start" && event.data.chain && typeof event.data.chain === "string") {
      return `Chain: ${event.data.chain}`;
    }
    if (event.event_type === "retriever_start" && event.data.retriever && typeof event.data.retriever === "string") {
      return `Retriever: ${event.data.retriever}`;
    }
    if (event.event_type === "llm_start" && event.data.model && typeof event.data.model === "string") {
      return `Model: ${event.data.model}`;
    }
    if (event.event_type === "text" && event.data.text && typeof event.data.text === "string") {
      return `${event.data.text.substring(0, 50)}${event.data.text.length > 50 ? "..." : ""}`;
    }
    if (event.data.tool && typeof event.data.tool === "string") {
      return String(event.data.tool);
    }
    return null;
  };

  const getCostDisplay = () => {
    if (typeof event.data.estimated_cost_usd === "number" && event.data.estimated_cost_usd > 0) {
      return `$${event.data.estimated_cost_usd.toFixed(6)}`;
    }
    return null;
  };

  const hasError = event.event_type.includes("error") || event.data.status_code === 2;
  const errorMessage =
    typeof event.data.error === "string"
      ? event.data.error
      : typeof event.data.status_message === "string"
        ? event.data.status_message
        : null;
  const timestamp = getTimestamp();

  return (
    <div
      className={cn(depth > 0 && "border-l-2 border-muted-foreground/20")}
      style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
    >
      <div
        className={`p-3 hover:bg-accent rounded-lg cursor-pointer transition-colors border border-transparent hover:border-border ${
          hasError ? "bg-red-50 dark:bg-red-950" : ""
        }`}
        onClick={onClick}
      >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="text-lg flex-shrink-0">{getEventEmoji(event.event_type)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={getEventColor(event.event_type)} className="text-xs flex-shrink-0">
                {getEventLabel()}
              </Badge>
              {event.event_type === "otel_span" && otelSpanCategory && (
                <Badge variant="outline" className="text-xs flex-shrink-0 capitalize">
                  {otelSpanCategory}
                </Badge>
              )}
              {getSecondaryInfo() && (
                <span className="text-xs text-muted-foreground truncate">
                  {getSecondaryInfo()}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>{timestamp ? formatDistanceToNow(timestamp) : "Unknown time"}</span>
              {hasError && errorMessage && (
                <span className="truncate text-red-600 dark:text-red-400 font-medium">
                  {errorMessage.substring(0, 30)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {getDurationDisplay() && (
            <span className="text-xs font-mono bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">
              {getDurationDisplay()}
            </span>
          )}
          {getTokenCount() && (
            <span className="text-xs font-mono bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 px-2 py-0.5 rounded">
              {getTokenCount()} tok
            </span>
          )}
          {getCostDisplay() && (
            <span className="text-xs font-mono bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded">
              {getCostDisplay()}
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
