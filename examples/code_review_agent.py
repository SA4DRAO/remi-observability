"""Code review agent — explicit LangGraph StateGraph with conditional routing.

Demonstrates:
- A custom StateGraph (NOT create_react_agent) with named nodes
- Conditional edge routing based on LLM classification output
- RunnableConfig propagation into LCEL chains inside graph nodes
- Remi OTLP traces via standard LangChain OpenTelemetry instrumentation

Graph structure:
    classify → security_review ─┐
             ↘                  ├→ summarize
               style_review ────┘

The 'classify' node asks the LLM to categorise the primary concern
(security vs. style/logic). The conditional edge routes to the relevant
specialist node before a final summarize node produces the PR comment.

Usage:
    python examples/code_review_agent.py
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Literal, TypedDict

import httpx
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from otel_setup import configure_otel, set_session_id

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

BACKEND_URL = os.getenv("REMI_BACKEND_URL", "http://localhost:3100")
API_KEY = os.getenv("REMI_API_KEY", "test-key-123")
ORG_ID = os.getenv("REMI_ORG_ID") or "org-engineering"
AGENT_ID = os.getenv("REMI_AGENT_ID") or "agent-code-review"
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")


# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------


class ReviewState(TypedDict):
    code: str
    language: str
    category: str           # "security" | "style"
    security_findings: str
    style_findings: str
    summary: str


# ---------------------------------------------------------------------------
# Code samples
# ---------------------------------------------------------------------------

SAMPLES = [
    {
        "language": "Python",
        "code": (
            "import subprocess\n"
            "def run_command(user_input):\n"
            "    result = subprocess.run(user_input, shell=True, capture_output=True)\n"
            "    return result.stdout.decode()\n"
        ),
        "metadata": {"repo": "api-gateway", "pr": 42},
    },
    {
        "language": "Python",
        "code": (
            "def calculate_average(numbers):\n"
            "    total = 0\n"
            "    for n in numbers: total = total + n\n"
            "    avg = total / len(numbers)\n"
            "    return avg\n"
        ),
        "metadata": {"repo": "data-utils", "pr": 17},
    },
    {
        "language": "Python",
        "code": (
            "def find_user(db, user_id):\n"
            "    query = f'SELECT * FROM users WHERE id = {user_id}'\n"
            "    return db.execute(query).fetchone()\n"
        ),
        "metadata": {"repo": "user-service", "pr": 88},
    },
]


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------


def build_graph(llm: ChatOpenAI) -> Any:
    """Compile a ReviewState graph. LangGraph passes RunnableConfig automatically
    to any node function that declares it as a second parameter."""

    parser = StrOutputParser()

    def classify_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(
                content="You are a code quality expert. Reply with exactly one word: security, style, or logic."
            ),
            HumanMessage(
                content=(
                    f"What is the PRIMARY concern in this {state['language']} code?\n\n"
                    f"{state['code']}"
                )
            ),
        ])
        raw = (prompt | llm | parser).invoke({}, config=config)
        category = raw.strip().lower().split()[0]
        if category not in ("security", "style", "logic"):
            category = "style"
        log.info("classify_node → %s", category)
        return {"category": category}

    def security_review_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(
                content="You are a security engineer. List vulnerabilities in 3 sentences max."
            ),
            HumanMessage(
                content=f"Identify security issues in this code:\n\n{state['code']}"
            ),
        ])
        findings = (prompt | llm | parser).invoke({}, config=config)
        return {"security_findings": findings}

    def style_review_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(
                content="You are a senior Python engineer. Give style and correctness feedback in 3 sentences max."
            ),
            HumanMessage(
                content=f"Review style and logic issues in this code:\n\n{state['code']}"
            ),
        ])
        findings = (prompt | llm | parser).invoke({}, config=config)
        return {"style_findings": findings}

    def summarize_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        findings = state.get("security_findings") or state.get("style_findings") or "No specific findings."
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(
                content="You are a tech lead. Write a 2-sentence PR review comment."
            ),
            HumanMessage(
                content=f"Summarise these findings as a PR comment:\n{findings}\n\nCode:\n{state['code']}"
            ),
        ])
        summary = (prompt | llm | parser).invoke({}, config=config)
        return {"summary": summary}

    def route_after_classify(state: ReviewState) -> Literal["security_review", "style_review"]:
        return "security_review" if state["category"] == "security" else "style_review"

    graph = StateGraph(ReviewState)
    graph.add_node("classify", classify_node)
    graph.add_node("security_review", security_review_node)
    graph.add_node("style_review", style_review_node)
    graph.add_node("summarize", summarize_node)

    graph.set_entry_point("classify")
    graph.add_conditional_edges("classify", route_after_classify)
    graph.add_edge("security_review", "summarize")
    graph.add_edge("style_review", "summarize")
    graph.add_edge("summarize", END)

    return graph.compile()


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


def create_session(name: str, metadata: dict[str, Any]) -> str:
    try:
        r = httpx.post(
            f"{BACKEND_URL}/api/v1/sessions",
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "X-Org-Id": ORG_ID,
                "X-Agent-Id": AGENT_ID,
            },
            json={
                "name": name,
                "metadata": metadata,
                "org_id": ORG_ID,
                "agent_id": AGENT_ID,
            },
            timeout=5.0,
        )
        if r.status_code == 201:
            return r.json()["session_id"]
    except Exception:
        pass
    return f"local-{int(time.time())}"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    log.info("Starting Code Review Agent (backend=%s, model=%s, org=%s, agent=%s)", BACKEND_URL, MODEL, ORG_ID, AGENT_ID)

    if not check_backend_health():
        log.warning("Backend unreachable — events may be lost")

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, api_key=openai_api_key)
    tracer_provider, tracer = configure_otel("remi.examples.code_review", org_id=ORG_ID)
    compiled_graph = build_graph(llm)

    log.info("Reviewing %d code samples", len(SAMPLES))

    try:
        for i, sample in enumerate(SAMPLES, start=1):
            session_id = create_session(
                name=f"Code Review #{i} ({sample['language']})",
                metadata={"agent_type": "state_graph", **sample["metadata"]},
            )
            log.info("Sample #%d  session=%s", i, session_id)
            set_session_id(session_id)

            try:
                with tracer.start_as_current_span(
                    "remi.session",
                    attributes={
                        "remi.session_id": session_id,
                    },
                ):
                    result = compiled_graph.invoke(
                        {"code": sample["code"], "language": sample["language"]}
                    )
                    log.info(
                        "Sample #%d  category=%s  summary=%s…",
                        i,
                        result.get("category"),
                        str(result.get("summary", ""))[:150],
                    )
            except Exception:
                log.exception("Sample #%d failed", i)

        log.info("All samples reviewed")
    
    finally:
        log.info("Flushing spans to backend...")
        tracer_provider.shutdown()
        log.info("Span export completed")


if __name__ == "__main__":
    main()
