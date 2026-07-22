import { X, Copy, Check, Sparkles, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { useSpanAttributes } from "../hooks/useSpanAttributes";
import { useSpanAnalysis } from "../hooks/useSpanAnalysis";
import type { Span, SpanAnalysisSuggestion } from "../types";

interface SpanDetailPanelProps {
  span: Span | null;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function tryPrettyJson(text: string): string {
  const t = text.trimStart();
  if ((t.startsWith("[") || t.startsWith("{")) && text.length < 50_000) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
  }
  return text;
}

function ContentBlock({ label, text }: { label: string; text: string }) {
  const display = tryPrettyJson(text);
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
        {display}
      </pre>
    </div>
  );
}

const IMPACT_STYLES: Record<SpanAnalysisSuggestion["impact"], string> = {
  high:   "border-red-300 bg-red-500/5 dark:border-red-800",
  medium: "border-amber-300 bg-amber-500/5 dark:border-amber-800",
  low:    "border-blue-300 bg-blue-500/5 dark:border-blue-800",
};

const IMPACT_BADGE: Record<SpanAnalysisSuggestion["impact"], string> = {
  high:   "border-red-400 text-red-600 dark:text-red-400",
  medium: "border-amber-400 text-amber-600 dark:text-amber-400",
  low:    "border-blue-400 text-blue-600 dark:text-blue-400",
};

// Prefix-based: openllmetry emits indexed keys like gen_ai.prompt.0.content.
const PROMPT_PREFIXES = ["llm.prompt", "gen_ai.prompt", "gen_ai.input", "gen_ai.system_instructions", "gen_ai.task.input", "llm.input_messages", "input.value", "traceloop.entity.input"] as const;
const COMPLETION_PREFIXES = ["llm.completion", "gen_ai.completion", "gen_ai.output", "gen_ai.task.output", "llm.output_messages", "output.value", "traceloop.entity.output"] as const;

function matchesPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => key === p || key.startsWith(`${p}.`));
}

function collectContent(attrs: Array<{ key: string; value: string | null }>, prefixes: readonly string[]): string {
  return attrs
    .filter((a) => a.value && matchesPrefix(a.key, prefixes))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((a) => a.value as string)
    .join("\n");
}

const RISK_STYLES: Record<string, string> = {
  low:    "border-green-400 text-green-600 dark:text-green-400",
  medium: "border-amber-400 text-amber-600 dark:text-amber-400",
  high:   "border-red-400 text-red-600 dark:text-red-400",
};

function ScorePill({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  const tone = value >= 8 ? "text-green-600 dark:text-green-400"
    : value >= 5 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${tone}`}>{value}/10</span>
    </div>
  );
}

export function SpanDetailPanel({ span, onClose }: SpanDetailPanelProps) {
  const { attributes, isPending } = useSpanAttributes(span?.span_id ?? null);
  const { analyze, result: analysisResult, isPending: isAnalyzing, error: analysisError, reset: resetAnalysis } =
    useSpanAnalysis(span?.session_id ?? "");

  const [showAnalysis, setShowAnalysis] = useState(false);

  if (!span) return null;

  const prompt = collectContent(attributes, PROMPT_PREFIXES);
  const completion = collectContent(attributes, COMPLETION_PREFIXES);
  const displayAttrs = attributes.filter(
    (a) => !matchesPrefix(a.key, PROMPT_PREFIXES) && !matchesPrefix(a.key, COMPLETION_PREFIXES)
  );

  const isError = span.status === "error";
  const statusClassName = isError
    ? "border-red-400 text-red-600 dark:text-red-400"
    : span.status === "ok"
    ? "border-green-400 text-green-600 dark:text-green-400"
    : "border-muted-foreground text-muted-foreground";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl sm:max-w-lg">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold" title={span.name}>{span.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusClassName}`}>
                {span.status}
              </Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {span.kind}
              </Badge>
              {span.model && (
                <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  {span.model}
                </Badge>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatDuration(span.duration_ms)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => { resetAnalysis(); setShowAnalysis(true); analyze(span.span_id); }}
              disabled={isAnalyzing}
            >
              <Sparkles className={`h-3 w-3 ${isAnalyzing ? "animate-pulse" : ""}`} />
              {isAnalyzing ? "Analyzing…" : "Analyze"}
            </Button>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* AI Analysis */}
          {showAnalysis && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  AI Analysis
                  {analysisResult && (
                    <span className="font-normal normal-case text-muted-foreground/70">· {analysisResult.model_used}</span>
                  )}
                </p>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowAnalysis(false)}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              </div>

              {isAnalyzing && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" />
                </div>
              )}

              {analysisError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{analysisError.message}</span>
                </div>
              )}

              {analysisResult && !isAnalyzing && (
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed">{analysisResult.analysis.summary}</p>

                  {analysisResult.analysis.scores && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Judge scores</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <ScorePill label="Correctness" value={analysisResult.analysis.scores.correctness} />
                        <ScorePill label="Instructions" value={analysisResult.analysis.scores.instruction_adherence} />
                        <ScorePill label="Tool use" value={analysisResult.analysis.scores.tool_use_quality} />
                        {analysisResult.analysis.scores.hallucination_risk && (
                          <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs">
                            <span className="text-muted-foreground">Hallucination</span>
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${RISK_STYLES[analysisResult.analysis.scores.hallucination_risk] ?? ""}`}>
                              {analysisResult.analysis.scores.hallucination_risk}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {analysisResult.analysis.flags && analysisResult.analysis.flags.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Compliance flags</p>
                      {analysisResult.analysis.flags.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-500/5 px-3 py-2 text-xs dark:border-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysisResult.analysis.time_breakdown.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Time breakdown</p>
                      {analysisResult.analysis.time_breakdown.map((tb, i) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono truncate max-w-[200px]" title={tb.span}>{tb.span}</span>
                            <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                              {tb.duration_ms}ms · {tb.pct}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, tb.pct)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {analysisResult.analysis.suggestions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
                      {analysisResult.analysis.suggestions.map((s, i) => (
                        <div key={i} className={`rounded-md border px-3 py-2.5 space-y-1 ${IMPACT_STYLES[s.impact]}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{s.title}</span>
                            <Badge variant="outline" className={`ml-auto shrink-0 text-[9px] px-1 py-0 ${IMPACT_BADGE[s.impact]}`}>{s.impact}</Badge>
                            <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 text-muted-foreground">{s.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!showAnalysis && analysisResult && (
            <button className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAnalysis(true)}>
              <Sparkles className="h-3 w-3" />
              Show AI analysis
              <ChevronDown className="h-3 w-3 ml-auto" />
            </button>
          )}

          {/* Identifiers */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-1">
              <span className="w-20 shrink-0 font-medium text-muted-foreground">Span ID</span>
              <span className="font-mono break-all">{span.span_id}</span>
              <CopyButton text={span.span_id} />
            </div>
            <div className="flex items-center gap-1">
              <span className="w-20 shrink-0 font-medium text-muted-foreground">Trace ID</span>
              <span className="font-mono break-all">{span.trace_id}</span>
              <CopyButton text={span.trace_id} />
            </div>
            {span.parent_span_id && (
              <div className="flex items-center gap-1">
                <span className="w-20 shrink-0 font-medium text-muted-foreground">Parent</span>
                <span className="font-mono break-all">{span.parent_span_id}</span>
              </div>
            )}
            {span.input_tokens != null && (
              <div className="flex items-center gap-1">
                <span className="w-20 shrink-0 font-medium text-muted-foreground">Tokens</span>
                <span className="font-mono text-muted-foreground">
                  {span.input_tokens.toLocaleString()} in · {(span.output_tokens ?? 0).toLocaleString()} out
                  {span.cache_tokens ? ` · ${span.cache_tokens.toLocaleString()} cached` : ""}
                </span>
              </div>
            )}
          </div>

          {/* LLM content */}
          {(prompt || completion) && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
                LLM Content
              </p>
              {prompt && <ContentBlock label="Prompt" text={prompt} />}
              {completion && <ContentBlock label="Response" text={completion} />}
            </div>
          )}

          {/* Attributes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Attributes {isPending ? "" : `(${displayAttrs.length})`}
            </p>
            {isPending ? (
              <div className="space-y-1.5">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : displayAttrs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No attributes recorded.</p>
            ) : (
              <div className="divide-y divide-border rounded-md border text-xs">
                {displayAttrs.map((attr) => (
                  <div key={attr.key} className="flex items-start gap-2 px-3 py-1.5">
                    <span className="w-[45%] shrink-0 font-mono text-muted-foreground break-all" title={attr.key}>
                      {attr.key}
                    </span>
                    <span className="min-w-0 flex-1 break-all font-mono">
                      {attr.value ?? <em className="text-muted-foreground">null</em>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
