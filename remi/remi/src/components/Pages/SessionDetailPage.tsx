/**
 * SessionDetailPage — V2 OTLP session detail with span tree, metrics, and model/tool breakdowns.
 */

import { ArrowLeft, AlertTriangle, RotateCw, Cpu, DollarSign, AlertCircle, GitBranch, Play, BarChart2, Network } from "lucide-react";
import { useState } from "react";
import { useSessionDetail } from "../../hooks/useSessionDetail";
import { useSpans } from "../../hooks/useSpans";
import { SpanTree } from "../SpanTree";
import { SpanDetailPanel } from "../SpanDetailPanel";
import { FlameChart } from "../FlameChart";
import { SessionReplay } from "../SessionReplay";
import { SpanCostBreakdown } from "../SpanCostBreakdown";
import type { SpanV2 } from "../../types/v2";
import { formatDistanceToNow, formatDate } from "../../utils/date-utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface SessionDetailPageProps {
  sessionId: string;
  sessionName: string | null;
  orgId: string | null;
  agentId: string | null;
  onBack: () => void;
}

function formatCost(cost: string | number | null | undefined): string {
  if (cost === null || cost === undefined) return "—";
  const n = parseFloat(String(cost));
  if (isNaN(n)) return "—";
  return n > 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function formatDurationNs(ns: number | null | undefined): string {
  if (ns === null || ns === undefined) return "—";
  const ms = ns / 1_000_000;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
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
    highlight === "red"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : highlight === "green"
        ? "bg-green-500/10 text-green-600 dark:text-green-400"
        : highlight === "blue"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : "bg-primary/10 text-primary";

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </p>
            <p className="mt-1 text-xl font-bold leading-tight">{value}</p>
            {subtext && (
              <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
            )}
          </div>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionDetailPage({
  sessionId,
  onBack,
}: SessionDetailPageProps) {
  const [selectedSpan, setSelectedSpan] = useState<SpanV2 | null>(null);
  const [spanView, setSpanView] = useState<"tree" | "flame" | "replay" | "cost">("tree");

  const { session, isPending: sessionLoading, error: sessionError, refetch: refetchSession } =
    useSessionDetail(sessionId);

  const { spans, hasMore: spansHasMore, isPending: spansLoading, error: spansError, refetch: refetchSpans } =
    useSpans(sessionId);

  const refetch = () => {
    void refetchSession();
    void refetchSpans();
  };

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
          <h1 className="truncate font-mono text-sm font-medium text-muted-foreground">
            {sessionId}
          </h1>
          {session && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {session.org_id && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  org: {session.org_id}
                </Badge>
              )}
              {session.agent_id && (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  agent: {session.agent_id}
                </Badge>
              )}
              {session.is_complete ? (
                <Badge
                  variant="outline"
                  className="border-green-300 text-[10px] text-green-600 dark:border-green-700 dark:text-green-400"
                >
                  complete
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-blue-300 text-[10px] text-blue-600 dark:border-blue-700 dark:text-blue-400"
                >
                  running
                </Badge>
              )}
              {session.has_error && (
                <Badge variant="destructive" className="text-[10px]">
                  has errors
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button onClick={refetch} disabled={isFetching} variant="outline" size="sm">
          <RotateCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Session load error */}
      {sessionError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load session</AlertTitle>
          <AlertDescription>{sessionError.message}</AlertDescription>
        </Alert>
      )}

      {/* Session metadata row */}
      {session && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Created:</span>{" "}
            {formatDate(session.created_at)}
          </span>
          {session.first_event_at && (
            <span>
              <span className="font-medium text-foreground">First span:</span>{" "}
              {formatDistanceToNow(session.first_event_at)}
            </span>
          )}
          {session.last_event_at && (
            <span>
              <span className="font-medium text-foreground">Last span:</span>{" "}
              {formatDistanceToNow(session.last_event_at)}
            </span>
          )}
          {session.total_duration_ns != null && (
            <span>
              <span className="font-medium text-foreground">Duration:</span>{" "}
              {formatDurationNs(session.total_duration_ns)}
            </span>
          )}
        </div>
      )}

      {/* Metrics cards */}
      {sessionLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : session ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <MetricCard
            label="Total Tokens"
            value={session.total_tokens.toLocaleString()}
            icon={<Cpu className="h-4 w-4" />}
            subtext={[
              `${session.prompt_tokens.toLocaleString()} in`,
              `${session.completion_tokens.toLocaleString()} out`,
              session.cache_read_tokens > 0 ? `${session.cache_read_tokens.toLocaleString()} cached` : null,
            ].filter(Boolean).join(" · ")}
          />
          <MetricCard
            label="Total Cost"
            value={formatCost(session.total_cost_usd)}
            icon={<DollarSign className="h-4 w-4" />}
            highlight="green"
            subtext={
              session.llm_spans > 0
                ? `${formatCost(parseFloat(String(session.total_cost_usd)) / session.llm_spans)} / LLM call`
                : undefined
            }
          />
          <MetricCard
            label="LLM Calls"
            value={session.llm_spans}
            icon={<Cpu className="h-4 w-4" />}
            highlight="blue"
            subtext={`${session.tool_spans} tool call${session.tool_spans !== 1 ? "s" : ""} · ${session.total_spans} total spans`}
          />
          <MetricCard
            label="Errors"
            value={session.error_count}
            icon={<AlertCircle className="h-4 w-4" />}
            highlight={session.error_count > 0 ? "red" : "none"}
            subtext={session.error_count === 0 ? "All spans successful" : "Check span details"}
          />
        </div>
      ) : null}

      {/* Span view card with tab toggle */}
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
            {/* View toggle */}
            <div className="flex rounded-md border text-xs overflow-hidden shrink-0">
              {(
                [
                  { key: "tree", label: "Tree", Icon: Network },
                  { key: "flame", label: "Flame", Icon: GitBranch },
                  { key: "replay", label: "Replay", Icon: Play },
                  { key: "cost", label: "Cost", Icon: BarChart2 },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setSpanView(key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                    spanView === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
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
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : spansError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Failed to load spans</AlertTitle>
              <AlertDescription>
                {spansError.message}
                <div className="mt-2">
                  <Button onClick={() => void refetchSpans()} variant="outline" size="sm">
                    <RotateCw className="mr-2 h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : spanView === "tree" ? (
            <SpanTree spans={spans} onSpanClick={setSelectedSpan} />
          ) : spanView === "flame" ? (
            <FlameChart spans={spans} onSpanClick={setSelectedSpan} selectedSpanId={selectedSpan?.span_id} />
          ) : spanView === "replay" ? (
            <SessionReplay spans={spans} onSpanClick={setSelectedSpan} />
          ) : (
            <SpanCostBreakdown sessionId={sessionId} />
          )}
        </CardContent>
      </Card>

      {/* Model usage */}
      {session && Object.keys(session.model_usage).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Model Usage</CardTitle>
            <CardDescription>Token and span counts per model</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Model</TableHead>
                  <TableHead className="px-4 text-right">Spans</TableHead>
                  <TableHead className="px-4 text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(session.model_usage)
                  .sort((a, b) => b[1].tokens - a[1].tokens)
                  .map(([model, usage]) => (
                    <TableRow key={model}>
                      <TableCell className="px-4 py-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {model}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                        {usage.spans}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                        {usage.tokens.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Tool usage */}
      {session && Object.keys(session.tool_usage).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tool Usage</CardTitle>
            <CardDescription>Call counts and error counts per tool</CardDescription>
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
                {Object.entries(session.tool_usage)
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([tool, usage]) => {
                    const errorRate =
                      usage.calls > 0
                        ? ((usage.errors / usage.calls) * 100).toFixed(1)
                        : "0.0";
                    return (
                      <TableRow key={tool}>
                        <TableCell className="px-4 py-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {tool}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                          {usage.calls}
                        </TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                          <span
                            className={
                              usage.errors > 0
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "text-muted-foreground"
                            }
                          >
                            {usage.errors}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                          <span
                            className={
                              usage.errors > 0
                                ? "font-medium text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }
                          >
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
