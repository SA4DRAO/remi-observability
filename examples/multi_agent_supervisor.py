"""Multi-agent pipeline demo — ReAct analyst feeding an LCEL writer, one session.

Demonstrates:
- Two conceptually separate agents collaborating in a single Remi session
- Stage 1 (Analyst): LangGraph ReAct agent gathers structured data with tools
- Stage 2 (Writer):  LCEL chain turns the analyst's output into a polished report
- Both stages run in one OTEL trace using standard LangChain instrumentation

This pattern models a common production pattern: a "thinking" agent that
tool-calls to gather facts, followed by a "writing" agent that formats the
result for end-users or downstream systems.

Architecture per scenario:
    analyst_agent.invoke(question)   →  structured_findings (str)
    writer_chain.invoke(findings)    →  final_report (str)
    [all callbacks routed to same handler → same Remi session]

Usage:
    python examples/multi_agent_supervisor.py
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import uuid

import httpx
from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from opentelemetry.instrumentation.langchain import LangchainInstrumentor

from otel_setup import configure_otel, set_session_id
from tool_failure import configure_example_tools, maybe_fail_tool_call

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

BACKEND_URL = os.getenv("REMI_BACKEND_URL", "http://localhost:3100")
ORG_ID = os.getenv("REMI_ORG_ID") or "demo-org"
AGENT_ID = os.getenv("REMI_AGENT_ID") or "supervisor-agent"
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

ANALYST_SYSTEM_PROMPT = """\
You are a data analyst. Use your tools to gather all requested metrics and facts.
Call tools in parallel whenever possible. Return a concise structured summary of
everything you found — bullet points, numbers, and key observations only.
"""

WRITER_SYSTEM_PROMPT = """\
You are a technical report writer. You receive structured analyst notes and
produce a clear, professional one-page report with an executive summary,
key findings, and a recommendation.
"""

# ---------------------------------------------------------------------------
# Simulated data stores
# ---------------------------------------------------------------------------

_SERVICE_METRICS: dict[str, dict[str, Any]] = {
    "api-gateway": {
        "p50_ms": 42,
        "p99_ms": 310,
        "error_rate_pct": 0.8,
        "rps": 1200,
        "uptime_pct": 99.97,
    },
    "inference-service": {
        "p50_ms": 820,
        "p99_ms": 4200,
        "error_rate_pct": 2.1,
        "rps": 85,
        "uptime_pct": 99.85,
    },
    "kafka-consumer": {
        "p50_ms": 12,
        "p99_ms": 88,
        "error_rate_pct": 0.05,
        "rps": 5000,
        "uptime_pct": 99.99,
    },
}

_INCIDENTS: dict[str, list[dict[str, Any]]] = {
    "api-gateway": [
        {"id": "INC-201", "severity": "P2", "duration_min": 12, "date": "2026-04-10", "resolved": True},
    ],
    "inference-service": [
        {"id": "INC-198", "severity": "P1", "duration_min": 45, "date": "2026-04-05", "resolved": True},
        {"id": "INC-203", "severity": "P2", "duration_min": 8, "date": "2026-04-22", "resolved": True},
    ],
    "kafka-consumer": [],
}

_DEPLOYMENT_HISTORY: dict[str, list[dict[str, Any]]] = {
    "api-gateway": [
        {"version": "v2.3.1", "date": "2026-04-28", "rolled_back": False},
        {"version": "v2.3.0", "date": "2026-04-15", "rolled_back": False},
    ],
    "inference-service": [
        {"version": "v1.8.2", "date": "2026-04-25", "rolled_back": True},
        {"version": "v1.8.1", "date": "2026-04-20", "rolled_back": False},
    ],
    "kafka-consumer": [
        {"version": "v3.0.0", "date": "2026-04-29", "rolled_back": False},
    ],
}


# ---------------------------------------------------------------------------
# Analyst tools
# ---------------------------------------------------------------------------


@tool
def get_service_metrics(service_name: str) -> dict[str, Any]:
    """Fetch latency, error rate, and throughput metrics for a service."""
    time.sleep(0.3)
    maybe_fail_tool_call("get_service_metrics")
    data = _SERVICE_METRICS.get(service_name)
    if data:
        return {"found": True, "service": service_name, **data}
    return {
        "found": False,
        "service": service_name,
        "available": list(_SERVICE_METRICS.keys()),
    }


@tool
def get_incident_history(service_name: str) -> dict[str, Any]:
    """Retrieve recent incident history for a service."""
    time.sleep(0.3)
    maybe_fail_tool_call("get_incident_history")
    incidents = _INCIDENTS.get(service_name)
    if incidents is None:
        return {"found": False, "service": service_name, "error": "Unknown service"}
    p1_count = sum(1 for i in incidents if i["severity"] == "P1")
    return {
        "found": True,
        "service": service_name,
        "total_incidents": len(incidents),
        "p1_incidents": p1_count,
        "incidents": incidents,
    }


@tool
def get_deployment_history(service_name: str) -> dict[str, Any]:
    """Get recent deployment history including any rollbacks."""
    time.sleep(0.2)
    maybe_fail_tool_call("get_deployment_history")
    deployments = _DEPLOYMENT_HISTORY.get(service_name)
    if deployments is None:
        return {"found": False, "service": service_name, "error": "Unknown service"}
    rollbacks = [d for d in deployments if d["rolled_back"]]
    return {
        "found": True,
        "service": service_name,
        "total_deployments": len(deployments),
        "rollbacks": len(rollbacks),
        "deployments": deployments,
    }


ANALYST_TOOLS = configure_example_tools(
    [get_service_metrics, get_incident_history, get_deployment_history]
)


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@dataclass
class Scenario:
    name: str
    analyst_question: str
    report_context: str
    metadata: dict[str, Any] = field(default_factory=dict)


SCENARIOS = [
    Scenario(
        name="inference-service health report",
        analyst_question=(
            "Analyse inference-service: gather its latency metrics, incident history, "
            "and deployment history all at once. Provide a structured summary."
        ),
        report_context="Monthly reliability review for inference-service",
        metadata={"service": "inference-service", "report_type": "health"},
    ),
    Scenario(
        name="Cross-service reliability comparison",
        analyst_question=(
            "Compare api-gateway and kafka-consumer: gather metrics and incident history "
            "for both services in parallel. Identify which is healthier and why."
        ),
        report_context="Q2 reliability comparison: api-gateway vs kafka-consumer",
        metadata={"report_type": "comparison"},
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def check_backend_health() -> bool:
    try:
        r = httpx.get(f"{BACKEND_URL}/health", timeout=5.0)
        ok = r.status_code == 200
        log.info("Backend health: %s", "OK" if ok else "FAIL")
        return ok
    except Exception as exc:
        log.error("Backend health check failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    log.info("Starting Multi-Agent Pipeline demo (backend=%s, model=%s, org=%s, agent=%s)", BACKEND_URL, MODEL, ORG_ID, AGENT_ID)

    if not check_backend_health():
        log.warning("Backend unreachable — events may be lost")

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, api_key=openai_api_key)
    tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)
    LangchainInstrumentor().instrument()

    # Stage 1: Analyst agent — LangGraph ReAct
    analyst_agent = create_react_agent(llm, ANALYST_TOOLS, prompt=ANALYST_SYSTEM_PROMPT)

    # Stage 2: Writer chain — plain LCEL
    writer_prompt = ChatPromptTemplate.from_messages([
        ("system", WRITER_SYSTEM_PROMPT),
        (
            "human",
            "Context: {context}\n\nAnalyst findings:\n{findings}\n\n"
            "Write the final report.",
        ),
    ])
    writer_chain = writer_prompt | llm | StrOutputParser()

    log.info("Processing %d scenarios", len(SCENARIOS))

    try:
        for scenario in SCENARIOS:
            session_id = f"supervisor-{uuid.uuid4().hex[:8]}"
            log.info("Scenario='%s'  session=%s", scenario.name, session_id)
            set_session_id(session_id)

            try:
                with tracer.start_as_current_span(
                    "remi.session",
                    attributes={
                        "remi.session_id": session_id,
                    },
                ):
                    # ---- Stage 1: Analyst gathers facts ----
                    analyst_result = analyst_agent.invoke(
                        {"messages": [("user", scenario.analyst_question)]}
                    )
                    messages = analyst_result.get("messages", [])
                    findings = messages[-1].content if messages else "(no analyst output)"
                    log.info("Analyst stage complete (%d chars)", len(findings))

                    # ---- Stage 2: Writer formats the report ----
                    report = writer_chain.invoke(
                        {"context": scenario.report_context, "findings": findings}
                    )
                    log.info("Report generated (%d chars): %s…", len(report), report[:150])

            except Exception:
                log.exception("Scenario='%s' failed", scenario.name)

        log.info("All scenarios processed")
    
    finally:
        log.info("Flushing spans to backend...")
        tracer_provider.shutdown()
        log.info("Span export completed")


if __name__ == "__main__":
    main()
