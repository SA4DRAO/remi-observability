"""Code review agent — explicit LangGraph StateGraph with conditional routing.

Demonstrates:
- Pure OTLP instrumentation via LangchainInstrumentor (no custom callback needed)
- A custom StateGraph (NOT create_react_agent) with named nodes
- Conditional edge routing based on LLM classification output

This is how a production customer would integrate: point your existing OTel
setup at the Remi collector and all LangChain/LangGraph calls are traced
automatically — no SDK-specific callback required.

Graph structure:
    classify → security_review ─┐
             ↘                  ├→ summarize
               style_review ────┘

Usage:
    python code_review_agent.py
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Literal, TypedDict

import httpx
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from opentelemetry.instrumentation.langchain import LangchainInstrumentor

from otel_setup import configure_otel, set_session_id

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

BACKEND_URL = os.getenv("REMI_BACKEND_URL", "http://localhost:3100")
ORG_ID = os.getenv("REMI_ORG_ID") or "demo-org"
AGENT_ID = os.getenv("REMI_AGENT_ID") or "code-review-agent"
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")


# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------


class ReviewState(TypedDict):
    code: str
    language: str
    category: str           # "security" | "style" | "logic"
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
    parser = StrOutputParser()

    def classify_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="You are a code quality expert. Reply with exactly one word: security, style, or logic."),
            HumanMessage(content=f"What is the PRIMARY concern in this {state['language']} code?\n\n{state['code']}"),
        ])
        raw = (prompt | llm | parser).invoke({}, config=config)
        category = raw.strip().lower().split()[0]
        if category not in ("security", "style", "logic"):
            category = "style"
        log.info("classify_node → %s", category)
        return {"category": category}

    def security_review_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="You are a security engineer. List vulnerabilities in 3 sentences max."),
            HumanMessage(content=f"Identify security issues in this code:\n\n{state['code']}"),
        ])
        return {"security_findings": (prompt | llm | parser).invoke({}, config=config)}

    def style_review_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="You are a senior Python engineer. Give style and correctness feedback in 3 sentences max."),
            HumanMessage(content=f"Review style and logic issues in this code:\n\n{state['code']}"),
        ])
        return {"style_findings": (prompt | llm | parser).invoke({}, config=config)}

    def summarize_node(state: ReviewState, config: RunnableConfig) -> dict[str, Any]:
        findings = state.get("security_findings") or state.get("style_findings") or "No specific findings."
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="You are a tech lead. Write a 2-sentence PR review comment."),
            HumanMessage(content=f"Summarise these findings as a PR comment:\n{findings}\n\nCode:\n{state['code']}"),
        ])
        return {"summary": (prompt | llm | parser).invoke({}, config=config)}

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

    tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)
    # Auto-instrument all LangChain/LangGraph calls — no callback needed.
    LangchainInstrumentor().instrument()

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, api_key=openai_api_key)
    compiled_graph = build_graph(llm)

    log.info("Reviewing %d code samples", len(SAMPLES))

    try:
        for i, sample in enumerate(SAMPLES, start=1):
            session_id = f"code-review-{uuid.uuid4().hex[:8]}"
            log.info("Sample #%d  session=%s", i, session_id)
            set_session_id(session_id)

            try:
                with tracer.start_as_current_span(
                    "code_review",
                    attributes={"remi.session_id": session_id},
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
