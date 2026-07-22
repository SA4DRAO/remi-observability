import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { useSpanAttributes } from "../hooks/useSpanAttributes";
import type { Span } from "../types";

interface SessionReplayProps {
  spans: Span[];
  onSpanClick?: (span: Span) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const PROMPT_KEYS = ["llm.prompt", "gen_ai.prompt", "gen_ai.input", "llm.input_messages", "input.value"] as const;
const COMPLETION_KEYS = ["llm.completion", "gen_ai.completion", "gen_ai.output", "llm.output_messages", "output.value"] as const;

function StepContent({ span }: { span: Span }) {
  const { attributes, isPending } = useSpanAttributes(span.span_id);

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const attrMap: Record<string, string> = {};
  for (const a of attributes) {
    if (a.value != null) attrMap[a.key] = a.value;
  }

  function firstNonEmpty(keys: readonly string[]): string {
    for (const k of keys) {
      const v = attrMap[k];
      if (v) return v;
    }
    return "";
  }

  const prompt = firstNonEmpty(PROMPT_KEYS);
  const completion = firstNonEmpty(COMPLETION_KEYS);

  const skipKeys = new Set([...PROMPT_KEYS, ...COMPLETION_KEYS] as string[]);
  const otherAttrs = attributes.filter((a) => !skipKeys.has(a.key));

  return (
    <div className="space-y-3">
      {prompt && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prompt</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">
            {prompt}
          </pre>
        </div>
      )}
      {completion && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Response</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">
            {completion}
          </pre>
        </div>
      )}
      {!prompt && !completion && otherAttrs.length === 0 && (
        <p className="text-xs text-muted-foreground">No content attributes for this span.</p>
      )}
      {otherAttrs.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Attributes ({otherAttrs.length})
          </summary>
          <div className="mt-1 divide-y divide-border rounded border text-xs">
            {otherAttrs.slice(0, 20).map((attr) => (
              <div key={attr.key} className="flex items-start gap-2 px-2 py-1">
                <span className="w-[45%] shrink-0 font-mono text-muted-foreground truncate">{attr.key}</span>
                <span className="min-w-0 flex-1 break-all font-mono">{attr.value ?? "null"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function SessionReplay({ spans, onSpanClick }: SessionReplayProps) {
  const [step, setStep] = useState(0);

  if (spans.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No spans to replay.</p>;
  }

  const sorted = [...spans].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
  const current = sorted[step];
  if (!current) return null;

  const isError = current.status === "error";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          aria-label="Previous span"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-semibold truncate">{current.name}</span>
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${
                isError
                  ? "border-red-400 text-red-600 dark:text-red-400"
                  : current.status === "ok"
                  ? "border-green-400 text-green-600 dark:text-green-400"
                  : "border-muted-foreground text-muted-foreground"
              }`}
            >
              {current.status}
            </Badge>
            {current.model && (
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {current.model}
              </Badge>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDuration(current.duration_ms)}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Step {step + 1} of {sorted.length}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => onSpanClick?.(current)}
          >
            <Sparkles className="h-3 w-3" />
            Analyze
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setStep((s) => Math.min(sorted.length - 1, s + 1))}
            disabled={step === sorted.length - 1}
            aria-label="Next span"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <StepContent span={current} />
    </div>
  );
}
