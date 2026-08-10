// Run with `bun test` — the only executable check in this package.
import { expect, test } from "bun:test";
import { deriveAttention } from "./attention";
import type { Session, VersionStats } from "../types";

const NOW = Date.parse("2026-08-07T12:00:00Z");

function version(over: Partial<VersionStats>): VersionStats {
  return {
    agent: "support-agent", version: "1.0.0", sessions: 100, llm_calls: 400,
    error_sessions: 2, error_rate: 0.02, avg_llm_latency_ms: 700, p95_llm_latency_ms: 1900,
    total_tokens: 500_000, avg_cpu_pct: 18, max_rss_bytes: 1 << 27, verdicts: 0,
    avg_correctness: null, avg_adherence: null, avg_tool_quality: null,
    first_seen: "2026-08-01T00:00:00Z", last_seen: "2026-08-07T00:00:00Z",
    ...over,
  };
}

function session(over: Partial<Session>): Session {
  return {
    session_id: "s1", agent_id: "support-agent", org_id: "acme",
    started_at: "2026-08-07T11:58:00Z", ended_at: null, duration_ms: 6200,
    status: "complete", primary_model: "gpt-4o-mini", span_count: 28, llm_calls: 8,
    tool_calls: 4, input_tokens: 10_000, output_tokens: 2_480, cache_tokens: 0,
    total_tokens: 12_480, avg_llm_latency_ms: 842,
    ...over,
  };
}

test("flags a newer release that got slower", () => {
  const items = deriveAttention(null, [
    version({ version: "1.5.0", avg_llm_latency_ms: 961, last_seen: "2026-08-07T00:00:00Z" }),
    version({ version: "1.4.0", avg_llm_latency_ms: 702, last_seen: "2026-08-05T00:00:00Z" }),
  ], [], NOW);
  expect(items).toHaveLength(1);
  expect(items[0].severity).toBe("err");
  expect(items[0].title).toBe("support-agent 1.5.0 regressed");
  expect(items[0].detail).toContain("+37%");
});

test("ignores a newer release within the noise band", () => {
  const items = deriveAttention(null, [
    version({ version: "1.5.0", avg_llm_latency_ms: 750, last_seen: "2026-08-07T00:00:00Z" }),
    version({ version: "1.4.0", avg_llm_latency_ms: 702, last_seen: "2026-08-05T00:00:00Z" }),
  ], [], NOW);
  expect(items).toHaveLength(0);
});

test("compares against the previous release, not an older one", () => {
  // 1.3.0 is slow, but 1.5.0 is only compared with its immediate predecessor.
  const items = deriveAttention(null, [
    version({ version: "1.3.0", avg_llm_latency_ms: 2000, last_seen: "2026-08-01T00:00:00Z" }),
    version({ version: "1.5.0", avg_llm_latency_ms: 720, last_seen: "2026-08-07T00:00:00Z" }),
    version({ version: "1.4.0", avg_llm_latency_ms: 702, last_seen: "2026-08-05T00:00:00Z" }),
  ], [], NOW);
  expect(items.filter((i) => i.id.startsWith("regress:"))).toHaveLength(0);
});

test("groups failed sessions per agent and keeps errors above warnings", () => {
  const items = deriveAttention(null, [version({ p95_llm_latency_ms: 6200 })], [
    session({ session_id: "a", status: "error" }),
    session({ session_id: "b", status: "error" }),
    session({ session_id: "c", status: "complete" }),
  ], NOW);
  expect(items[0].severity).toBe("err");
  expect(items[0].title).toBe("2 sessions failed in support-agent");
  expect(items[0].sessionId).toBeUndefined();
  expect(items[1].severity).toBe("warn");
});

test("only calls a running session stalled once it is old enough", () => {
  const fresh = deriveAttention(null, [], [
    session({ status: "running", started_at: "2026-08-07T11:58:00Z" }),
  ], NOW);
  expect(fresh).toHaveLength(0);

  const stale = deriveAttention(null, [], [
    session({ session_id: "z", status: "running", started_at: "2026-08-07T11:40:00Z" }),
  ], NOW);
  expect(stale).toHaveLength(1);
  expect(stale[0].target).toBe("trace");
  expect(stale[0].sessionId).toBe("z");
});
