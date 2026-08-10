import { AlertTriangle, Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import { useSpanAnalysis } from "../hooks/useSpanAnalysis";
import { useSpanAttributes } from "../hooks/useSpanAttributes";
import { formatLatency, spanColor } from "../utils/format";
import { SystemMetricsPanel } from "./SystemMetricsPanel";
import { Skeleton } from "./ui/skeleton";
import type { SessionDetail, Span, SpanAnalysisSuggestion } from "../types";

export type InspectorTab = "span" | "session" | "system" | "judge";

const TABS: Array<[InspectorTab, string]> = [
  ["span", "Span"], ["session", "Session"], ["system", "System"], ["judge", "Judge"],
];

// Prefix-based: openllmetry emits indexed keys like gen_ai.prompt.0.content.
const PROMPT_PREFIXES = ["llm.prompt", "gen_ai.prompt", "gen_ai.input", "gen_ai.system_instructions", "gen_ai.task.input", "llm.input_messages", "input.value", "traceloop.entity.input"] as const;
const COMPLETION_PREFIXES = ["llm.completion", "gen_ai.completion", "gen_ai.output", "gen_ai.task.output", "llm.output_messages", "output.value", "traceloop.entity.output"] as const;

function matchesPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => key === p || key.startsWith(`${p}.`));
}

function collectContent(
  attrs: Array<{ key: string; value: string | null }>,
  prefixes: readonly string[]
): string {
  return attrs
    .filter((a) => a.value && matchesPrefix(a.key, prefixes))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((a) => a.value as string)
    .join("\n");
}

function tryPrettyJson(text: string): string {
  const t = text.trimStart();
  if ((t.startsWith("[") || t.startsWith("{")) && text.length < 50_000) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not JSON */
    }
  }
  return text;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-muted-foreground hover:text-foreground"
      title="Copy"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b p-4">
      <div className="kicker mb-2">{title}</div>
      {children}
    </div>
  );
}

const SCORE_COLOR = (v: number) => (v >= 8 ? "var(--ok)" : v >= 5 ? "var(--warn)" : "var(--err)");
const RISK_COLOR: Record<string, string> = { low: "var(--ok)", medium: "var(--warn)", high: "var(--err)" };
const IMPACT_COLOR: Record<SpanAnalysisSuggestion["impact"], string> = {
  high: "var(--err)", medium: "var(--warn)", low: "var(--info)",
};

interface SpanInspectorProps {
  sessionId: string;
  span: Span | null;
  session: SessionDetail | null;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}

export function SpanInspector({ sessionId, span, session, tab, onTabChange }: SpanInspectorProps) {
  const { attributes, isPending: attrsPending } = useSpanAttributes(span?.span_id ?? null);
  const { analyze, result, isPending: isAnalyzing, error: analysisError, reset } = useSpanAnalysis(sessionId);

  const prompt = collectContent(attributes, PROMPT_PREFIXES);
  const completion = collectContent(attributes, COMPLETION_PREFIXES);
  const otherAttrs = attributes.filter(
    (a) => !matchesPrefix(a.key, PROMPT_PREFIXES) && !matchesPrefix(a.key, COMPLETION_PREFIXES)
  );

  const runJudge = () => {
    if (!span) return;
    reset();
    onTabChange("judge");
    analyze(span.span_id);
  };

  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <div className="flex shrink-0 border-b bg-subtle">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className="flex-1 px-1 py-2.5 text-[11px]"
            style={{
              color: tab === key ? "var(--foreground)" : "var(--muted-foreground)",
              fontWeight: tab === key ? 700 : 500,
              boxShadow: tab === key ? "inset 0 -2px 0 0 var(--foreground)" : undefined,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "span" && (
          !span ? (
            <p className="p-4 text-[11px] text-muted-foreground">Select a span to inspect it.</p>
          ) : (
            <>
              <div className="border-b p-4">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: spanColor(span) }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-bold" title={span.name}>{span.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{formatMs(span.duration_ms)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="chip">{span.kind}</span>
                  {span.model && <span className="chip">{span.model}</span>}
                  <span
                    className="chip chip-outline"
                    style={{ color: span.status === "error" ? "var(--err)" : span.status === "ok" ? "var(--ok)" : undefined }}
                  >
                    {span.status}
                  </span>
                  {span.input_tokens != null && (
                    <span className="chip chip-outline">
                      {span.input_tokens.toLocaleString()} in · {(span.output_tokens ?? 0).toLocaleString()} out
                    </span>
                  )}
                </div>
                {span.status_message && (
                  <p className="mt-2 text-[11px]" style={{ color: "var(--err)" }}>{span.status_message}</p>
                )}
                <button
                  className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  onClick={runJudge}
                  disabled={isAnalyzing}
                >
                  <Sparkles className={`h-3 w-3 ${isAnalyzing ? "animate-pulse" : ""}`} />
                  {isAnalyzing ? "Judging…" : "Run LLM judge on this span"}
                </button>
              </div>

              {prompt && (
                <Block title="Prompt">
                  <pre className="code max-h-[150px]">{tryPrettyJson(prompt)}</pre>
                </Block>
              )}
              {completion && (
                <Block title="Response">
                  <pre className="code max-h-[150px]">{tryPrettyJson(completion)}</pre>
                </Block>
              )}

              <div className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="kicker">Attributes</span>
                  <span className="text-[10px] text-muted-foreground">{attrsPending ? "" : otherAttrs.length}</span>
                  <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                    span <CopyButton text={span.span_id} />
                    trace <CopyButton text={span.trace_id} />
                  </span>
                </div>
                {attrsPending ? (
                  <div className="space-y-1">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                  </div>
                ) : otherAttrs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No attributes recorded.</p>
                ) : (
                  <div className="rowlist overflow-hidden rounded-md border">
                    {otherAttrs.map((a) => (
                      <div key={a.key} className="flex gap-2 px-2.5 py-1 text-[10px]">
                        <span className="w-[46%] shrink-0 break-all text-muted-foreground">{a.key}</span>
                        <span className="min-w-0 flex-1 break-all">{a.value ?? "null"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        )}

        {tab === "session" && (
          !session ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : (
            <>
              <Block title="Models">
                {Object.entries(session.models).length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No LLM spans in this session.</p>
                ) : (
                  Object.entries(session.models)
                    .sort((a, b) => b[1].input_tokens - a[1].input_tokens)
                    .map(([model, stat]) => (
                      <div key={model} className="flex items-baseline gap-2 py-1 text-[11px]">
                        <span className="font-semibold">{model}</span>
                        <span className="text-muted-foreground">{stat.calls} calls</span>
                        <span className="ml-auto tabular-nums">
                          {(stat.input_tokens + stat.output_tokens).toLocaleString()}
                        </span>
                        <span className="w-14 text-right tabular-nums text-muted-foreground">
                          {formatLatency(stat.avg_latency_ms)}
                        </span>
                      </div>
                    ))
                )}
              </Block>

              <Block title="Tools">
                {Object.entries(session.tools).length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No tool spans in this session.</p>
                ) : (
                  Object.entries(session.tools)
                    .sort((a, b) => b[1].calls - a[1].calls)
                    .map(([tool, stat]) => {
                      const rate = stat.calls > 0 ? (stat.errors / stat.calls) * 100 : 0;
                      return (
                        <div key={tool} className="flex items-baseline gap-2 py-1 text-[11px]">
                          <span className="font-semibold">{tool}</span>
                          <span className="ml-auto text-muted-foreground">{stat.calls} calls</span>
                          <span
                            className="w-12 text-right tabular-nums"
                            style={{ color: stat.errors > 0 ? "var(--err)" : "var(--muted-foreground)" }}
                          >
                            {rate.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })
                )}
              </Block>

              <div className="p-4">
                <div className="kicker mb-2">Runtime</div>
                <RuntimeRows resource={session.resource ?? {}} />
              </div>
            </>
          )
        )}

        {tab === "system" && <SystemMetricsPanel sessionId={sessionId} />}

        {tab === "judge" && (
          <div className="flex flex-col gap-3.5 p-4">
            {!result && !isAnalyzing && !analysisError && (
              <p className="text-pretty text-[11px] text-muted-foreground">
                No verdict yet. Pick an LLM span and run the judge from the Span tab.
              </p>
            )}
            {isAnalyzing && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {analysisError && (
              <div className="flex items-start gap-2 rounded-md border p-2.5 text-[11px]" style={{ borderColor: "var(--err)", color: "var(--err)" }}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{analysisError.message}</span>
              </div>
            )}
            {result && !isAnalyzing && (
              <>
                <p className="text-pretty text-[11px] leading-relaxed">{result.analysis.summary}</p>

                {result.analysis.scores && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      ["correctness", result.analysis.scores.correctness],
                      ["instructions", result.analysis.scores.instruction_adherence],
                      ["tool use", result.analysis.scores.tool_use_quality],
                    ] as const).map(([label, value]) =>
                      value == null ? null : (
                        <div key={label} className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                          <span className="text-xs font-bold tabular-nums" style={{ color: SCORE_COLOR(value) }}>
                            {value}/10
                          </span>
                        </div>
                      )
                    )}
                    {result.analysis.scores.hallucination_risk && (
                      <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                        <span className="text-[10px] text-muted-foreground">hallucination</span>
                        <span
                          className="text-xs font-bold"
                          style={{ color: RISK_COLOR[result.analysis.scores.hallucination_risk] }}
                        >
                          {result.analysis.scores.hallucination_risk}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {result.analysis.flags && result.analysis.flags.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="kicker">Flags</div>
                    {result.analysis.flags.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]" style={{ borderColor: "var(--warn)" }}>
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: "var(--warn)" }} />
                        <span className="text-pretty">{f}</span>
                      </div>
                    ))}
                  </div>
                )}

                {result.analysis.time_breakdown.length > 0 && (
                  <div>
                    <div className="kicker mb-2">Where the time went</div>
                    {result.analysis.time_breakdown.map((tb, i) => (
                      <div key={i} className="mb-1.5">
                        <div className="mb-0.5 flex justify-between text-[10px]">
                          <span className="truncate" title={tb.span}>{tb.span}</span>
                          <span className="shrink-0 pl-2 tabular-nums text-muted-foreground">
                            {tb.duration_ms}ms · {tb.pct}%
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-sm bg-muted">
                          <div className="h-full" style={{ width: `${Math.min(100, tb.pct)}%`, background: "var(--chart-1)" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {result.analysis.suggestions.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="kicker">Suggestions</div>
                    {result.analysis.suggestions.map((s, i) => (
                      <div key={i} className="rounded-md border px-2.5 py-2" style={{ borderColor: IMPACT_COLOR[s.impact] }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold">{s.title}</span>
                          <span className="chip chip-outline ml-auto" style={{ color: IMPACT_COLOR[s.impact] }}>{s.impact}</span>
                          <span className="chip chip-outline">{s.category}</span>
                        </div>
                        <p className="mt-1 text-pretty text-[10px] leading-relaxed text-muted-foreground">{s.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground">judged by {result.model_used}</p>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Keys emitted by the standard OTel resource detectors (os, process, host). */
function RuntimeRows({ resource }: { resource: Record<string, string> }) {
  const known = new Set([
    "host.name", "host.arch", "os.type", "os.version", "os.description",
    "process.runtime.name", "process.runtime.version", "process.runtime.description",
    "process.owner", "process.pid", "process.parent_pid", "process.command",
    "process.command_line", "process.command_args", "process.executable.name",
    "process.executable.path", "telemetry.sdk.name", "telemetry.sdk.version",
    "telemetry.sdk.language", "service.version", "service.name", "service.namespace", "remi.org_id",
  ]);
  const rows: Array<[string, string | undefined]> = [
    ["host", resource["host.name"]],
    ["arch", resource["host.arch"]],
    ["os", resource["os.type"] && `${resource["os.type"]} ${resource["os.version"] ?? ""}`.trim()],
    ["runtime", resource["process.runtime.name"] && `${resource["process.runtime.name"]} ${resource["process.runtime.version"] ?? ""}`.trim()],
    ["owner", resource["process.owner"]],
    ["pid", resource["process.pid"]],
    ["sdk", resource["telemetry.sdk.name"] && `${resource["telemetry.sdk.name"]} ${resource["telemetry.sdk.version"] ?? ""} (${resource["telemetry.sdk.language"] ?? "?"})`],
    ["version", resource["service.version"]],
    ...Object.entries(resource)
      .filter(([k]) => !known.has(k))
      .map(([k, v]) => [k.split(".").pop() ?? k, v] as [string, string]),
  ];
  const present = rows.filter(([, v]) => v);
  if (present.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No resource attributes on this session.</p>;
  }
  return (
    <>
      {present.map(([label, value]) => (
        <div key={label} className="flex gap-2 py-0.5 text-[10px]">
          <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
          <span className="break-all">{value}</span>
        </div>
      ))}
    </>
  );
}
