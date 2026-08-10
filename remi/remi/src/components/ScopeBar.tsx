import { useEffect, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { RANGES, STATUSES, type Scope } from "../lib/scope";

/**
 * Relative freshness label. The clock lives in state and only the interval
 * advances it, so render stays pure (no Date.now() while rendering).
 */
function useAgo(timestamp: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  if (!timestamp) return null;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

interface ScopeBarProps {
  scope: Scope;
  onChange: (scope: Scope) => void;
  /** Agent ids seen in the current window, for the dropdown. */
  agents: string[];
  /** Status only filters the sessions list, so analytics/versions hide it. */
  showStatus?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  onRefresh: () => void;
}

export function ScopeBar({
  scope,
  onChange,
  agents,
  showStatus = true,
  updatedAt,
  isFetching,
  onRefresh,
}: ScopeBarProps) {
  const ago = useAgo(updatedAt);

  return (
    <div className="sticky top-12 z-40 border-b bg-subtle">
      <div className="shell flex h-11 items-center gap-2">
        <span className="kicker mr-0.5">scope</span>

        <select
          className="ctl"
          aria-label="Filter by agent"
          value={scope.agent}
          onChange={(e) => onChange({ ...scope, agent: e.target.value })}
        >
          <option value="">all agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          className="ctl"
          aria-label="Time range"
          value={scope.days}
          onChange={(e) => onChange({ ...scope, days: Number(e.target.value) })}
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>{r.label}</option>
          ))}
        </select>

        {showStatus && (
          <div className="seg" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                aria-pressed={scope.status === s.value}
                onClick={() => onChange({ ...scope, status: s.value })}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {scope.agent && (
          <span className="chip gap-1.5 pl-2.5 pr-1.5 text-[11px]">
            agent: {scope.agent}
            <button
              className="opacity-55 hover:opacity-100"
              aria-label="Clear agent filter"
              onClick={() => onChange({ ...scope, agent: "" })}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {ago && (
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
              <span className="dot" style={{ background: "var(--ok)", width: 5, height: 5 }} />
              live · updated {ago}
            </span>
          )}
          <button className="ctl" onClick={onRefresh} disabled={isFetching}>
            <RotateCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
