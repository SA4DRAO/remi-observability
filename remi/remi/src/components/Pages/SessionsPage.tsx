import { useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Hash,
  RotateCw,
  Zap,
} from "lucide-react";
import { useSessions } from "../../hooks/useSessions";
import { formatDistanceToNow } from "../../utils/date-utils";
import { formatLatency } from "../../utils/format";
import type { Session } from "../../types";
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
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

const PAGE_SIZE = 20;

interface SessionsPageProps {
  onSelectSession: (sessionId: string, name: string | null) => void;
  selectedAgentId: string | null;
  onChangeAgentId: (agentId: string | null) => void;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  subtext?: string;
}

function StatCard({ label, value, icon, subtext }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold leading-tight sm:text-2xl">{value}</p>
            {subtext && <p className="mt-1 text-xs leading-snug text-muted-foreground">{subtext}</p>}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Session["status"] }) {
  if (status === "complete") {
    return (
      <Badge variant="outline" className="border-green-300 px-1.5 py-0 text-[10px] text-green-600 dark:border-green-700 dark:text-green-400">
        <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />
        Complete
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
        Error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-blue-300 px-1.5 py-0 text-[10px] text-blue-600 dark:border-blue-700 dark:text-blue-400">
      <Clock className="mr-0.5 h-2.5 w-2.5" />
      Running
    </Badge>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface SessionRowProps {
  session: Session;
  onClick: () => void;
}

function SessionRow({ session, onClick }: SessionRowProps) {
  const shortId = session.session_id.length > 16
    ? `${session.session_id.slice(0, 8)}…${session.session_id.slice(-6)}`
    : session.session_id;

  return (
    <TableRow className="group cursor-pointer" onClick={onClick}>
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-foreground truncate max-w-[180px]" title={session.session_id}>
            {shortId}
          </span>
          <StatusBadge status={session.status} />
        </div>
        {session.primary_model && (
          <Badge variant="secondary" className="mt-1 font-mono text-[9px] px-1 py-0">
            {session.primary_model}
          </Badge>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground truncate max-w-[120px]" title={session.agent_id ?? ""}>
          {session.agent_id || "—"}
        </span>
      </TableCell>

      <TableCell className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatDistanceToNow(session.started_at)}
      </TableCell>

      <TableCell className="px-4 py-3 text-center tabular-nums text-sm">
        {session.span_count}
      </TableCell>

      <TableCell className="px-4 py-3 text-center tabular-nums text-sm">
        {session.llm_calls}
      </TableCell>

      <TableCell className="px-4 py-3 text-right tabular-nums text-sm">
        {session.total_tokens.toLocaleString()}
      </TableCell>

      <TableCell className="px-4 py-3 text-right tabular-nums text-sm">
        {formatLatency(session.avg_llm_latency_ms)}
      </TableCell>

      <TableCell className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
        {formatDuration(session.duration_ms)}
      </TableCell>

      <TableCell className="w-8 px-2 py-3">
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </TableCell>
    </TableRow>
  );
}

export function SessionsPage({
  onSelectSession,
  selectedAgentId,
  onChangeAgentId,
}: SessionsPageProps) {
  const [agentInput,  setAgentInput]  = useState(selectedAgentId ?? "");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [statusFilter, setStatusFilter] = useState<Session["status"] | "">("");
  const [page, setPage] = useState(0);

  const [appliedAgent,  setAppliedAgent]  = useState(selectedAgentId ?? "");
  const [appliedStart,  setAppliedStart]  = useState("");
  const [appliedEnd,    setAppliedEnd]    = useState("");
  const [appliedStatus, setAppliedStatus] = useState<Session["status"] | "">("");

  const { sessions, total, isPending, isFetching, error, refetch } = useSessions({
    agent_id:  appliedAgent || undefined,
    date_from: appliedStart || undefined,
    date_to:   appliedEnd   || undefined,
    status:    appliedStatus || undefined,
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilters = () => {
    const agent = agentInput.trim() || "";
    setAppliedAgent(agent);
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setAppliedStatus(statusFilter);
    onChangeAgentId(agent || null);
    setPage(0);
  };

  const clearFilters = () => {
    setAgentInput(""); setStartDate(""); setEndDate(""); setStatusFilter("");
    setAppliedAgent(""); setAppliedStart(""); setAppliedEnd(""); setAppliedStatus("");
    onChangeAgentId(null);
    setPage(0);
  };

  const hasActiveFilters = !!(appliedAgent || appliedStart || appliedEnd || appliedStatus);

  // Quick stats from current page
  const totalTokens  = sessions.reduce((s, sess) => s + sess.total_tokens, 0);
  const errorCount   = sessions.filter((s) => s.status === "error").length;
  const completeCount = sessions.filter((s) => s.status === "complete").length;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Connection Error</AlertTitle>
        <AlertDescription className="mt-2">
          {error.message}
          <div className="mt-3">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RotateCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            OTLP trace sessions from instrumented LLM applications
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={isFetching} variant="outline" size="sm">
          <RotateCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Quick stats */}
      {!isPending && sessions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sessions (page)" value={sessions.length} icon={<Hash className="h-5 w-5" />} subtext={`${total} total`} />
          <StatCard label="Complete" value={completeCount} icon={<CheckCircle2 className="h-5 w-5" />} subtext={`${sessions.length - completeCount - errorCount} still running`} />
          <StatCard label="Errors" value={errorCount} icon={<Activity className="h-5 w-5" />} />
          <StatCard label="Total Tokens" value={totalTokens.toLocaleString()} icon={<Cpu className="h-5 w-5" />} subtext="this page" />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input value={agentInput} onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              placeholder="Filter by agent id" />
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Session["status"] | "")}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All statuses</option>
              <option value="running">Running</option>
              <option value="complete">Complete</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={applyFilters} size="sm">Apply</Button>
            <Button onClick={clearFilters} disabled={!hasActiveFilters} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Sessions table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>
            {isPending ? "Loading…" : `${total} session${total !== 1 ? "s" : ""} found`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-2 px-4 py-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Zap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium">No sessions found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Send OTLP traces to the collector at port 4318.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Session</TableHead>
                  <TableHead className="px-4">Agent</TableHead>
                  <TableHead className="px-4">Started</TableHead>
                  <TableHead className="px-4 text-center">Spans</TableHead>
                  <TableHead className="px-4 text-center">LLM Calls</TableHead>
                  <TableHead className="px-4 text-right">Tokens</TableHead>
                  <TableHead className="px-4 text-right">LLM Latency</TableHead>
                  <TableHead className="px-4 text-right">Duration</TableHead>
                  <TableHead className="w-8 px-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <SessionRow
                    key={session.session_id}
                    session={session}
                    onClick={() => onSelectSession(session.session_id, null)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} · {total} total
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
