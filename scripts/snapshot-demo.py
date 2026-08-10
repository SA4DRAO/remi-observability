#!/usr/bin/env python3
"""Snapshot the live API into a static fixture the dashboard can serve without a backend.

    python3 scripts/snapshot-demo.py [--key acme-admin-key] [--sessions 40]

Writes remi/remi/public/demo-data.json. Only the *primitives* are captured —
the demo adapter (src/utils/demo-data.ts) filters, paginates and searches over
them client-side, so the fixture stays small and every filter combination still
works instead of only the ones that happened to be snapshotted.

Aggregates (analytics, versions) can't be recomputed in the browser, so those
ARE captured per (agent x window) combination and looked up by key.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:3100")
ap.add_argument("--key", default="acme-admin-key")
ap.add_argument("--sessions", type=int, default=40, help="most recent N sessions to capture")
ap.add_argument("--max-attr", type=int, default=1500, help="truncate attribute values past this")
ap.add_argument("--max-points", type=int, default=120, help="downsample metric series to this many points")
ap.add_argument("--out", default="remi/remi/public/demo-data.json")
args = ap.parse_args()

WINDOWS = [1, 7, 30]

# Mirrors the CHARTED list in remi/remi/src/components/SystemMetricsPanel.tsx.
# If a metric is added to a chart there, add its prefix here or the demo will
# render an empty panel where the live dashboard shows a series.
CHARTED_METRICS = (
    "process.cpu.utilization",
    "process.runtime.cpython.cpu.utilization",
    "process.memory.usage",
    "process.runtime.cpython.memory (rss)",
    "process.memory.virtual",
    "system.memory.utilization (used)",
)


def get(path, params=None):
    url = args.base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {args.key}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get("data")
    except Exception as e:  # noqa: BLE001 - a missing endpoint shouldn't kill the snapshot
        print(f"  ! {path} {params or ''} -> {e}", file=sys.stderr)
        return None


def truncate(v):
    if isinstance(v, str) and len(v) > args.max_attr:
        return v[: args.max_attr] + "…[truncated for demo]"
    return v


print("· sessions")
listing = get("/api/v1/sessions", {"limit": args.sessions, "offset": 0}) or {}
sessions = listing.get("sessions", [])
print(f"  {len(sessions)} sessions")

agents = sorted({s["agent_id"] for s in sessions if s.get("agent_id")})

# Aggregates: one entry per (agent, window). "" = all agents.
analytics, versions = {}, {}
print("· analytics + versions")
for days in WINDOWS:
    date_from = (date.today() - timedelta(days=days)).isoformat()
    for agent in [""] + agents:
        p = {"days": days, "date_from": date_from}
        if agent:
            p["agent_id"] = agent
        analytics[f"{agent}|{days}"] = get("/api/v1/analytics", p)

        vp = {"date_from": date_from}
        if agent:
            vp["agent_id"] = agent
        versions[f"{agent}|{days}"] = get("/api/v1/analytics/versions", vp)
print(f"  {len(analytics)} analytics, {len(versions)} version rollups")

# Per-session detail. Spans carry the prompts, so this dominates the payload.
details, spans_by_session, metrics_by_session, attrs_by_span, analysis_by_span = {}, {}, {}, {}, {}
print("· per-session detail / spans / metrics")
for i, s in enumerate(sessions, 1):
    sid = s["session_id"]
    details[sid] = get(f"/api/v1/sessions/{sid}")
    sp = (get(f"/api/v1/sessions/{sid}/spans", {"limit": 500, "offset": 0}) or {}).get("spans", [])
    for span in sp:
        # Attributes live once, in attrs_by_span (what useSpanAttributes reads).
        # Nothing renders span.attributes off the list response, and keeping both
        # copies doubled the fixture — 4.2MB of prompts stored twice.
        attrs_by_span[span["span_id"]] = {
            k: truncate(v) for k, v in (span.pop("attributes", None) or {}).items()
        }
        # Only LLM spans can carry a verdict; asking for the rest is 400 x 404.
        if span.get("model"):
            stored = get(f"/api/v1/sessions/{sid}/spans/{span['span_id']}/analysis")
            if stored:
                analysis_by_span[span["span_id"]] = stored
    spans_by_session[sid] = sp

    m = get(f"/api/v1/sessions/{sid}/system-metrics") or {}
    # Keep only what SystemMetricsPanel actually charts. The exporter also emits
    # system.cpu.utilization per core (16 series) and a pile of cpython gauges
    # that no view reads — they were 2.7MB of the fixture on their own.
    series = [s_ for s_ in m.get("metrics", []) if s_.get("name", "").startswith(CHARTED_METRICS)]
    for s_ in series:  # charts don't need 20k points; keep the shape, drop the bulk
        pts = s_.get("points", [])
        if len(pts) > args.max_points:
            step = len(pts) / args.max_points
            s_["points"] = [pts[int(i * step)] for i in range(args.max_points)]
    metrics_by_session[sid] = series
    print(f"  [{i}/{len(sessions)}] {sid}: {len(sp)} spans", end="\r")
print()

bundle = {
    "generated_at": date.today().isoformat(),
    "sessions": sessions,
    "agents": agents,
    "windows": WINDOWS,
    "analytics": analytics,
    "versions": versions,
    "details": details,
    "spans": spans_by_session,
    "metrics": metrics_by_session,
    "attributes": attrs_by_span,
    "analysis": analysis_by_span,
}

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), args.out)
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(bundle, f, separators=(",", ":"))

# Self-check: every lookup src/utils/demo-data.ts performs must resolve, or the
# demo renders a blank panel that no type-check or build would catch.
problems = []
for s in sessions:
    sid = s["session_id"]
    if not details.get(sid):
        problems.append(f"missing detail for session {sid}")
    if sid not in spans_by_session:
        problems.append(f"missing spans for session {sid}")
    for span in spans_by_session.get(sid, []):
        if span["span_id"] not in attrs_by_span:
            problems.append(f"missing attributes for span {span['span_id']}")
for days in WINDOWS:
    for agent in [""] + agents:
        if analytics.get(f"{agent}|{days}") is None:
            problems.append(f"missing analytics for '{agent}' / {days}d")
        if versions.get(f"{agent}|{days}") is None:
            problems.append(f"missing versions for '{agent}' / {days}d")

if problems:
    print(f"\n!! {len(problems)} gap(s) — the demo would render blanks:", file=sys.stderr)
    for p in problems[:15]:
        print(f"   - {p}", file=sys.stderr)
    sys.exit(1)

size = os.path.getsize(out)
print(f"→ {out}  {size/1_048_576:.2f} MB")
print(f"  self-check: all {len(sessions)} sessions, "
      f"{len(WINDOWS) * (len(agents) + 1)} aggregate keys, "
      f"{len(attrs_by_span)} span attribute sets resolve")
print(f"  {len(sessions)} sessions · {sum(len(v) for v in spans_by_session.values())} spans "
      f"· {len(analysis_by_span)} stored judge verdicts")
