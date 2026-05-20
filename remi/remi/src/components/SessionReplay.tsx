/**
 * SessionReplay — step through agent actions in chronological order.
 * Each step shows the span's metadata and its prompt/response inline.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { useSpanAttributes } from "../hooks/useSpanAttributes";
import type { SpanV2 } from "../types/v2";

interface SessionReplayProps {
  spans: SpanV2[];
  onSpanClick?: (span: SpanV2) => void;
}

function formatNs(ns: number): string {
  const ms = ns / 1_000_000;
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function statusLabel(code: number): { label: string; className: string } {
  if (code === 2) return { label: "error", className: "border-red-400 text-red-600 dark:text-red-400" };
  if (code === 1) return { label: "ok", className: "border-green-400 text-green-600 dark:text-green-400" };
  return { label: "unset", className: "border-muted-foreground text-muted-foreground" };
}

const PROMPT_KEYS = ["llm.prompt", "gen_ai.prompt", "gen_ai.input", "llm.input_messages", "input.value"] as const;
const COMPLETION_KEYS = ["llm.completion", "gen_ai.completion", "gen_ai.output", "llm.output_messages", "output.value"] as const;

function StepContent({ span }: { span: SpanV2 }) {
  const { attributes, isPending } = useSpanAttributes(span.span_id);

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const attrMap = Object.fromEntries(attributes.map((a) => [a.key, a.value ?? ""]));

  function firstNonEmpty(keys: readonly string[]): string {
    for (const k of keys) {
      const v = attrMap[k];
      if (v) return v;
    }
    return "";
  }

  const prompt = firstNonEmpty(PROMPT_KEYS);
  const completion = firstNonEmpty(COMPLETION_KEYS);

  const otherAttrs = attributes.filter(
    (a) => !([...PROMPT_KEYS, ...COMPLETION_KEYS] as string[]).includes(a.key)
  );

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

  const sorted = [...spans].sort((a, b) => a.start_time_ns - b.start_time_ns);
  const current = sorted[step];
  if (!current) return null;

  const status = statusLabel(current.status_code);

  return (
    <div className="space-y-4">
      {/* Step navigation */}
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
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${status.className}`}>
              {status.label}
            </Badge>
            {current.model_name && (
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {current.model_name}
              </Badge>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatNs(current.duration_ns)}
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

      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${((step + 1) / sorted.length) * 100}%` }}
        />
      </div>

      {/* Step content */}
      <StepContent span={current} />
    </div>
  );
}
