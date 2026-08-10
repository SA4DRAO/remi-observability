import { useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useSessions } from "../../hooks/useSessions";
import { formatDistanceToNow } from "../../utils/date-utils";
import { formatDuration, formatLatency, shortId, statusColor } from "../../utils/format";
import { dateFrom, type Scope } from "../../lib/scope";
import { Skeleton } from "../ui/skeleton";
import type { Session } from "../../types";

const PAGE_SIZE = 20;

const COLUMNS: Array<[keyof Session, string]> = [
  ["session_id", "session"], ["agent_id", "agent"], ["primary_model", "model"],
  ["status", "status"], ["duration_ms", "duration_ms"], ["span_count", "spans"],
  ["llm_calls", "llm_calls"], ["total_tokens", "tokens"],
  ["avg_llm_latency_ms", "avg_llm_latency_ms"], ["started_at", "started_at"],
];

function exportCsv(sessions: Session[]) {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    COLUMNS.map(([, header]) => header).join(","),
    ...sessions.map((s) => COLUMNS.map(([key]) => escape(s[key])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `remi-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SessionsPage({
  scope,
  onSelectSession,
}: {
  scope: Scope;
  onSelectSession: (sessionId: string) => void;
}) {
  const [page, setPage] = useState(0);

  const { sessions, total, isPending, error, refetch } = useSessions({
    agent_id: scope.agent || undefined,
    date_from: dateFrom(scope.days),
    status: scope.status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const maxDuration = Math.max(1, ...sessions.map((s) => s.duration_ms ?? 0));

  if (error) {
    return (
      <div className="panel flex items-start gap-3 p-4" style={{ borderColor: "var(--err)" }}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--err)" }} />
        <div>
          <p className="text-xs font-semibold">Connection error</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{error.message}</p>
          <button className="ctl mt-3" onClick={() => refetch()}>
            <RotateCw className="h-3 w-3" />Retry
          </button>
        </div>
      </div>
    );
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="sect-head">
        <h1 className="m-0 text-base font-bold tracking-tight">Sessions</h1>
        <span className="sect-note">
          {isPending ? "loading…" : `${total.toLocaleString()} matching · showing ${from}–${to}`}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button className="ctl" onClick={() => exportCsv(sessions)} disabled={sessions.length === 0}>
            Export
          </button>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="dtable">
          <thead>
            <tr>
              <th>Session</th>
              <th>Agent</th>
              <th>Model</th>
              <th style={{ width: 190 }}>Duration</th>
              <th className="num">Spans</th>
              <th className="num">LLM</th>
              <th className="num">Tokens</th>
              <th className="num">Avg LLM</th>
              <th className="num">Started</th>
            </tr>
          </thead>
          <tbody>
            {isPending &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={9}><Skeleton className="h-5 w-full" /></td></tr>
              ))}

            {!isPending && sessions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <p className="text-xs font-medium">No sessions match this scope</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Send OTLP traces to http://localhost:3100 with your org API key as{" "}
                    <code>Authorization: Bearer &lt;key&gt;</code>.
                  </p>
                </td>
              </tr>
            )}

            {sessions.map((s) => (
              <tr key={s.session_id} className="cursor-pointer" onClick={() => onSelectSession(s.session_id)}>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="dot" style={{ background: statusColor(s.status) }} />
                    <span className="text-[11px]" title={s.session_id}>{shortId(s.session_id)}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap font-semibold">{s.agent_id ?? "—"}</td>
                <td className="dim whitespace-nowrap text-[11px]">{s.primary_model ?? "—"}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="bar">
                      <span
                        style={{
                          width: `${Math.min(100, ((s.duration_ms ?? 0) / maxDuration) * 100)}%`,
                          background: s.status === "error" ? "var(--chart-err)" : s.status === "running" ? "var(--info)" : "var(--chart-1)",
                        }}
                      />
                    </span>
                    <span className="w-12 text-right text-[11px] tabular-nums">
                      {s.status === "running" ? "—" : formatDuration(s.duration_ms)}
                    </span>
                  </span>
                </td>
                <td className="num">{s.span_count}</td>
                <td className="num">{s.llm_calls}</td>
                <td className="num">{s.total_tokens.toLocaleString()}</td>
                <td className="num" style={{ color: s.avg_llm_latency_ms > 1800 ? "var(--warn)" : undefined }}>
                  {formatLatency(s.avg_llm_latency_ms)}
                </td>
                <td className="num dim whitespace-nowrap text-[11px]">{formatDistanceToNow(s.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t bg-subtle px-4 py-2">
          <span className="text-[11px] text-muted-foreground">page {page + 1} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button className="ctl ctl-sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              Previous
            </button>
            <button
              className="ctl ctl-sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
