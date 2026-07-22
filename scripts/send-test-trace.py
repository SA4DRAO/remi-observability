#!/usr/bin/env python3
"""Send synthetic OTLP GenAI traces to the collector for end-to-end testing.

Mimics what a GenAI-instrumented agent (or Claude Code) emits: a root agent span
plus LLM call spans (with gen_ai.* attributes) and a tool span, grouped by
gen_ai.conversation.id so Remi treats them as one session.
"""
import json
import os
import secrets
import sys
import time
import urllib.request

ENDPOINT = os.environ.get("OTLP_ENDPOINT", "http://localhost:4318") + "/v1/traces"

NS = 1_000_000_000


def hex_id(n_bytes: int) -> str:
    return secrets.token_hex(n_bytes)


def attr(key, value):
    if isinstance(value, int):
        return {"key": key, "value": {"intValue": value}}
    return {"key": key, "value": {"stringValue": str(value)}}


def span(name, kind, start_ns, dur_ns, trace_id, span_id, parent_id, attrs, error=False):
    s = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name,
        "kind": kind,
        "startTimeUnixNano": str(start_ns),
        "endTimeUnixNano": str(start_ns + dur_ns),
        "attributes": [attr(k, v) for k, v in attrs.items()],
        "status": {"code": 2, "message": "tool failed"} if error else {"code": 1},
    }
    if parent_id:
        s["parentSpanId"] = parent_id
    return s


def build_session(conv_id, model, provider, agent, org, base_ns, with_error=False):
    """One conversation = one Remi session, several spans."""
    trace_id = hex_id(16)
    root_id = hex_id(8)
    spans = []

    # Root agent span (INTERNAL = kind 1)
    spans.append(span(
        f"agent {agent}", 1, base_ns, 6 * NS, trace_id, root_id, None,
        {"gen_ai.conversation.id": conv_id, "gen_ai.operation.name": "agent"},
    ))

    # LLM call 1 (CLIENT = kind 3)
    spans.append(span(
        f"chat {model}", 3, base_ns + 200_000_000, int(2.4 * NS), trace_id, hex_id(8), root_id,
        {
            "gen_ai.conversation.id": conv_id,
            "gen_ai.system": provider,
            "gen_ai.request.model": model,
            "gen_ai.usage.input_tokens": 1240,
            "gen_ai.usage.output_tokens": 380,
            "gen_ai.usage.cache_read_input_tokens": 900,
        },
    ))

    # Tool span (CLIENT, no model => tool)
    spans.append(span(
        "tool web_search", 3, base_ns + int(2.8 * NS), int(0.9 * NS), trace_id, hex_id(8), root_id,
        {"gen_ai.conversation.id": conv_id, "tool.name": "web_search"},
        error=with_error,
    ))

    # LLM call 2
    spans.append(span(
        f"chat {model}", 3, base_ns + int(3.9 * NS), int(1.8 * NS), trace_id, hex_id(8), root_id,
        {
            "gen_ai.conversation.id": conv_id,
            "gen_ai.system": provider,
            "gen_ai.request.model": model,
            "gen_ai.usage.input_tokens": 2100,
            "gen_ai.usage.output_tokens": 540,
            "gen_ai.usage.cache_read_input_tokens": 1600,
        },
    ))

    return {
        "resource": {
            "attributes": [attr("service.name", agent), attr("service.namespace", org)]
        },
        "scopeSpans": [{"scope": {"name": "remi.test"}, "spans": spans}],
    }


def main():
    now = time.time_ns()
    # Two sessions, slightly in the past so they read as a real timeline.
    payload = {
        "resourceSpans": [
            build_session("conv-alpha", "claude-opus-4-5", "anthropic",
                          "claude-code", "demo-org", now - 30 * NS),
            build_session("conv-beta", "claude-sonnet-4-5", "anthropic",
                          "research-agent", "demo-org", now - 20 * NS, with_error=True),
        ]
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        ENDPOINT, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode()
        print(f"POST {ENDPOINT} -> {resp.status}")
        print(f"response: {body or '(empty)'}")
    n = sum(len(rs["scopeSpans"][0]["spans"]) for rs in payload["resourceSpans"])
    print(f"sent {n} spans across {len(payload['resourceSpans'])} sessions")


if __name__ == "__main__":
    sys.exit(main())
