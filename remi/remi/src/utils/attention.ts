import type { Analytics, Session, VersionStats } from "../types";
import {
  ERROR_RATE_REGRESSION_PP,
  LATENCY_REGRESSION_PCT,
  errorRateDeltaPp,
  isRegression,
  latencyDeltaPct,
} from "../lib/regression";

export type Severity = "err" | "warn" | "info";
export type AttentionTarget = "versions" | "sessions" | "analytics" | "trace";

export interface AttentionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** ISO timestamp the item is anchored to, rendered as relative time. */
  at: string | null;
  target: AttentionTarget;
  /** Set when the item points at one specific session. */
  sessionId?: string;
  /** Set when the item is about one agent, so the target page can scope to it. */
  agent?: string;
}

// Regression thresholds live in lib/regression.ts (shared with the versions
// page's per-agent verdict, so the two views can't disagree on what counts).
const SLOW_P95_MS = 4000;
const STALLED_AFTER_MS = 5 * 60_000;
const MAX_ITEMS = 6;

const SEVERITY_RANK: Record<Severity, number> = { err: 0, warn: 1, info: 2 };

/** Newest two named releases of each agent, newest first. */
function releasePairs(versions: VersionStats[]): Array<[VersionStats, VersionStats]> {
  const byAgent = new Map<string, VersionStats[]>();
  for (const v of versions) {
    if (v.version === "unversioned") continue;
    const list = byAgent.get(v.agent) ?? [];
    list.push(v);
    byAgent.set(v.agent, list);
  }
  const pairs: Array<[VersionStats, VersionStats]> = [];
  for (const list of byAgent.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
    );
    pairs.push([sorted[0], sorted[1]]);
  }
  return pairs;
}

/**
 * Turns the three feeds the overview already loads into a ranked "look here"
 * list. Pure so the thresholds stay testable — see attention.test.ts.
 */
export function deriveAttention(
  analytics: Analytics | null,
  versions: VersionStats[],
  sessions: Session[],
  now: number = Date.now()
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1. A newer release that is measurably worse than the one before it.
  for (const [latest, prev] of releasePairs(versions)) {
    if (!isRegression(latest, prev)) continue;
    const latPct = latencyDeltaPct(latest, prev);
    const errPp = errorRateDeltaPp(latest, prev);

    const parts: string[] = [];
    if (latPct >= LATENCY_REGRESSION_PCT) parts.push(`avg latency +${latPct.toFixed(0)}%`);
    if (errPp >= ERROR_RATE_REGRESSION_PP) parts.push(`error rate +${errPp.toFixed(1)}pp`);
    items.push({
      id: `regress:${latest.agent}:${latest.version}`,
      severity: "err",
      title: `${latest.agent} ${latest.version} regressed`,
      detail: `${parts.join(" and ")} against ${prev.version}`,
      at: latest.last_seen,
      target: "versions",
      agent: latest.agent,
    });
  }

  // 2. Failed sessions, grouped by agent so one bad tool shows up as one item.
  const failedByAgent = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.status !== "error") continue;
    const key = s.agent_id ?? "unknown agent";
    failedByAgent.set(key, [...(failedByAgent.get(key) ?? []), s]);
  }
  for (const [agent, failed] of failedByAgent) {
    const models = [...new Set(failed.map((s) => s.primary_model).filter(Boolean))];
    items.push({
      id: `failed:${agent}`,
      severity: "err",
      title: `${failed.length} session${failed.length === 1 ? "" : "s"} failed in ${agent}`,
      detail: models.length > 0 ? `on ${models.join(", ")}` : "no model recorded on the failing spans",
      at: failed[0].started_at,
      target: "sessions",
      agent,
      sessionId: failed.length === 1 ? failed[0].session_id : undefined,
    });
  }

  // 3. Slow tails. p95 only exists on the version rollup, so read it there.
  for (const v of versions) {
    if (v.p95_llm_latency_ms <= SLOW_P95_MS) continue;
    items.push({
      id: `p95:${v.agent}:${v.version}`,
      severity: "warn",
      title: `${v.agent} p95 above ${(SLOW_P95_MS / 1000).toFixed(0)}s`,
      detail: `${(v.p95_llm_latency_ms / 1000).toFixed(2)}s on ${v.version} — ${v.sessions} session${v.sessions === 1 ? "" : "s"} affected`,
      at: v.last_seen,
      target: "analytics",
      agent: v.agent,
    });
  }

  // 4. Sessions whose root span never landed — the exporter may have died.
  for (const s of sessions) {
    if (s.status !== "running") continue;
    const elapsed = now - new Date(s.started_at).getTime();
    if (elapsed < STALLED_AFTER_MS) continue;
    items.push({
      id: `stalled:${s.session_id}`,
      severity: "info",
      title: `${s.agent_id ?? "session"} still running`,
      detail: `${(elapsed / 60_000).toFixed(0)}m elapsed, root span open — may be stalled`,
      at: s.started_at,
      target: "trace",
      sessionId: s.session_id,
      agent: s.agent_id ?? undefined,
    });
  }

  // 5. Whole-org error rate, only when nothing more specific explains it.
  if (analytics && analytics.totals.error_rate > 0.05 && items.length === 0) {
    items.push({
      id: "org-error-rate",
      severity: "warn",
      title: `Error rate at ${(analytics.totals.error_rate * 100).toFixed(1)}%`,
      detail: `${analytics.totals.error_sessions} of ${analytics.totals.sessions} sessions failed in this window`,
      at: null,
      target: "sessions",
    });
  }

  return items
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime();
    })
    .slice(0, MAX_ITEMS);
}
