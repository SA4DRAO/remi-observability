import { ArrowLeft, AlertTriangle, RotateCw, Cpu, AlertCircle, GitBranch, Network, Play } from "lucide-react";
import { useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useSpans } from "../../hooks/useSpans";
import { SpanTree } from "../SpanTree";
import { SpanDetailPanel } from "../SpanDetailPanel";
import { FlameChart } from "../FlameChart";
import { SessionReplay } from "../SessionReplay";
import type { Span } from "../../types";
import { formatDistanceToNow, formatDate } from "../../utils/date-utils";
import { formatLatency } from "../../utils/format";
import { SystemMetricsPanel } from "../SystemMetricsPanel";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface SessionDetailPageProps {
  sessionId: string;
  onBack: () => void;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  subtext?: string;
  highlight?: "red" | "green" | "blue" | "none";
}

function MetricCard({ label, value, icon, subtext, highlight = "none" }: MetricCardProps) {
  const iconBg =
    highlight === "red"   ? "bg-red-500/10 text-red-600 dark:text-red-400"
    : highlight === "green" ? "bg-green-500/10 text-green-600 dark:text-green-400"
    : highlight === "blue"  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    : "bg-primary/10 text-primary";

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-xl font-bold leading-tight">{value}</p>
            {subtext && <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>}
          </div>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionDetailPage({ sessionId, onBack }: SessionDetailPageProps) {
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [spanView, setSpanView] = useState<"tree" | "flame" | "replay">("tree");

  const { session, isPending: sessionLoading, error: sessionError, refetch: refetchSession } =
    useSession(sessionId);

  const { spans, hasMore: spansHasMore, isPending: spansLoading, error: spansError, refetch: refetchSpans } =
    useSpans(sessionId);

  const refetch = () => { void refetchSession(); void refetchSpans(); };
  const isFetching = sessionLoading || spansLoading;

  return (
    <>
      <SpanDetailPanel span={selectedSpan} onClose={() => setSelectedSpan(null)} />
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to sessions">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-mono text-sm font-medium text-muted-foreground">{sessionId}</h1>
            {session && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {session.org_id && (
                  <Badge variant="outline" className="font-mono text-[10px]">org: {session.org_id}</Badge>
                )}
                {session.agent_id && (
                  <Badge variant="secondary" className="font-mono text-[10px]">agent: {session.agent_id}</Badge>
                )}
                {session.primary_model && (
                  <Badge variant="secondary" className="font-mono text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300">
                    {session.primary_model}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={
                    session.status === "complete"
                      ? "border-green-300 text-[10px] text-green-600 dark:border-green-700 dark:text-green-400"
                      : session.status === "error"
                      ? "border-red-300 text-[10px] text-red-600 dark:border-red-700 dark:text-red-400"
                      : "border-blue-300 text-[10px] text-blue-600 dark:border-blue-700 dark:text-blue-400"
                  }
                >
                  {session.status}
                </Badge>
              </div>
            )}
          </div>
          <Button onClick={refetch} disabled={isFetching} variant="outline" size="sm">
            <RotateCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {sessionError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load session</AlertTitle>
            <AlertDescription>{sessionError.message}</AlertDescription>
          </Alert>
        )}

        {/* Metadata row */}
        {session && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">Started:</span>{" "}
              {formatDate(session.started_at)}
            </span>
            {session.ended_at && (
              <span>
                <span className="font-medium text-foreground">Last span:</span>{" "}
                {formatDistanceToNow(session.ended_at)}
              </span>
            )}
            {session.duration_ms != null && (
              <span>
                <span className="font-medium text-foreground">Duration:</span>{" "}
                {formatDuration(session.duration_ms)}
              </span>
            )}
          </div>
        )}

        {/* Metrics */}
        {sessionLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : session ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Avg LLM Latency"
              value={formatLatency(session.avg_llm_latency_ms)}
              icon={<Cpu className="h-4 w-4" />}
              highlight="green"
              subtext="mean LLM span duration"
            />
            <MetricCard
              label="Total Tokens"
              value={session.total_tokens.toLocaleString()}
              icon={<Cpu className="h-4 w-4" />}
              subtext={[
                `${session.input_tokens.toLocaleString()} in`,
                `${session.output_tokens.toLocaleString()} out`,
                session.cache_tokens > 0 ? `${session.cache_tokens.toLocaleString()} cached` : null,
              ].filter(Boolean).join(" · ")}
            />
            <MetricCard
              label="LLM Calls"
              value={session.llm_calls}
              icon={<Cpu className="h-4 w-4" />}
              highlight="blue"
              subtext={`${session.tool_calls} tool call${session.tool_calls !== 1 ? "s" : ""} · ${session.span_count} total spans`}
            />
            <MetricCard
              label="Duration"
              value={formatDuration(session.duration_ms)}
              icon={<RotateCw className="h-4 w-4" />}
            />
            <MetricCard
              label="Errors"
              value={spans.filter((s) => s.status === "error").length}
              icon={<AlertCircle className="h-4 w-4" />}
              highlight={spans.some((s) => s.status === "error") ? "red" : "none"}
              subtext={spans.some((s) => s.status === "error") ? "Check span details" : "All spans successful"}
            />
          </div>
        ) : null}

        {/* Span view */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Trace Explorer</CardTitle>
                <CardDescription>
                  {spansLoading
                    ? "Loading spans…"
                    : spansHasMore
                    ? `Showing first ${spans.length} spans — more exist`
                    : `${spans.length} span${spans.length !== 1 ? "s" : ""}`}
                </CardDescription>
              </div>
              <div className="flex rounded-md border text-xs overflow-hidden shrink-0">
                {([
                  { key: "tree",   label: "Tree",   Icon: Network },
                  { key: "flame",  label: "Flame",  Icon: GitBranch },
                  { key: "replay", label: "Replay", Icon: Play },
                ] as const).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setSpanView(key)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                      spanView === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {spansLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : spansError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Failed to load spans</AlertTitle>
                <AlertDescription>
                  {spansError.message}
                  <div className="mt-2">
                    <Button onClick={() => void refetchSpans()} variant="outline" size="sm">
                      <RotateCw className="mr-2 h-3.5 w-3.5" />Retry
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : spanView === "tree" ? (
              <SpanTree spans={spans} onSpanClick={setSelectedSpan} />
            ) : spanView === "flame" ? (
              <FlameChart spans={spans} onSpanClick={setSelectedSpan} selectedSpanId={selectedSpan?.span_id} />
            ) : (
              <SessionReplay spans={spans} onSpanClick={setSelectedSpan} />
            )}
          </CardContent>
        </Card>

        {/* System metrics (CPU/memory of the agent process) */}
        <SystemMetricsPanel sessionId={sessionId} />

        {/* Runtime environment */}
        {session && Object.keys(session.resource ?? {}).length > 0 && (() => {
          const r = session.resource;
          // Keys emitted by the standard OTel resource detectors (os, process, host)
          const rows: Array<[string, string | undefined]> = [
            ["Host", r["host.name"]],
            ["Arch", r["host.arch"]],
            ["OS", r["os.type"] && `${r["os.type"]} ${r["os.version"] ?? ""}`],
            ["Runtime", r["process.runtime.name"] && `${r["process.runtime.name"]} ${r["process.runtime.version"] ?? ""}`],
            ["Owner", r["process.owner"]],
            ["PID", r["process.pid"]],
            ["SDK", r["telemetry.sdk.name"] && `${r["telemetry.sdk.name"]} ${r["telemetry.sdk.version"] ?? ""} (${r["telemetry.sdk.language"] ?? "?"})`],
            ["Version", r["service.version"]],
          ];
          const known = new Set(["host.name", "host.arch", "os.type", "os.version", "os.description",
            "process.runtime.name", "process.runtime.version", "process.runtime.description",
            "process.owner", "process.pid", "process.parent_pid", "process.command",
            "process.command_line", "process.command_args", "process.executable.name",
            "process.executable.path",
            "telemetry.sdk.name", "telemetry.sdk.version", "telemetry.sdk.language", "service.version",
            "service.name", "service.namespace", "remi.org_id"]);
          const extras = Object.entries(r).filter(([k]) => !known.has(k));
          return (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Runtime Environment</CardTitle>
                <CardDescription>Where this agent ran — from OTLP resource attributes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2">
                  {rows.filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="w-16 shrink-0 font-medium text-muted-foreground">{label}</span>
                      <span className="font-mono break-all">{value}</span>
                    </div>
                  ))}
                  {extras.map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="w-16 shrink-0 truncate font-medium text-muted-foreground" title={k}>
                        {k.split(".").pop()}
                      </span>
                      <span className="font-mono break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Model usage */}
        {session && Object.keys(session.models).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Model Usage</CardTitle>
              <CardDescription>Token breakdown per model</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Model</TableHead>
                    <TableHead className="px-4 text-right">Calls</TableHead>
                    <TableHead className="px-4 text-right">Input</TableHead>
                    <TableHead className="px-4 text-right">Output</TableHead>
                    <TableHead className="px-4 text-right">Cached</TableHead>
                    <TableHead className="px-4 text-right">Avg Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(session.models)
                    .sort((a, b) => b[1].input_tokens - a[1].input_tokens)
                    .map(([model, stat]) => (
                      <TableRow key={model}>
                        <TableCell className="px-4 py-2">
                          <Badge variant="secondary" className="font-mono text-xs">{model}</Badge>
                        </TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{stat.calls}</TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{stat.input_tokens.toLocaleString()}</TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{stat.output_tokens.toLocaleString()}</TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
                          {stat.cache_tokens > 0 ? stat.cache_tokens.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                          {formatLatency(stat.avg_latency_ms)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Tool usage */}
        {session && Object.keys(session.tools).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tool Usage</CardTitle>
              <CardDescription>Call counts and error rates per tool</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Tool</TableHead>
                    <TableHead className="px-4 text-right">Calls</TableHead>
                    <TableHead className="px-4 text-right">Errors</TableHead>
                    <TableHead className="px-4 text-right">Error Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(session.tools)
                    .sort((a, b) => b[1].calls - a[1].calls)
                    .map(([tool, stat]) => {
                      const errorRate = stat.calls > 0 ? ((stat.errors / stat.calls) * 100).toFixed(1) : "0.0";
                      return (
                        <TableRow key={tool}>
                          <TableCell className="px-4 py-2">
                            <Badge variant="outline" className="font-mono text-xs">{tool}</Badge>
                          </TableCell>
                          <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{stat.calls}</TableCell>
                          <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                            <span className={stat.errors > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                              {stat.errors}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                            <span className={stat.errors > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                              {errorRate}%
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
