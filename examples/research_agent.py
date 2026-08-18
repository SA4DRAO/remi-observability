"""Research agent demo — LangGraph ReAct with a knowledge-domain tool set.

Demonstrates:
- A second LangGraph ReAct agent (contrast with customer_support_agent.py)
- Different tools: definitions, paper search, model benchmarks, calculator
- Parallel tool calls across different knowledge sources
- Remi OTLP traces via standard LangChain OpenTelemetry instrumentation

Key difference from customer_support_agent: lighter tool use per query,
broader knowledge domain, heavier use of parallel lookups.

Usage:
    python examples/research_agent.py
"""
from __future__ import annotations

import json
import logging
import math
import os
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any

import uuid

from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent


from tool_failure import configure_example_tools, maybe_fail_tool_call

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL")  # None → api.openai.com
EXA_API_KEY = os.getenv("EXA_API_KEY")

SYSTEM_PROMPT = """\
You are a research assistant with access to a local knowledge base.
When a question touches multiple topics, call ALL relevant tools in a single
response (parallel tool calls) to gather information efficiently.
After gathering data, synthesise a clear, cited answer.
"""

# ---------------------------------------------------------------------------
# Simulated knowledge base
# ---------------------------------------------------------------------------

_DEFINITIONS: dict[str, str] = {
    "transformer": (
        "A neural network architecture using self-attention, introduced in "
        "'Attention Is All You Need' (Vaswani et al., 2017)."
    ),
    "rag": (
        "Retrieval-Augmented Generation: augmenting LLM context with retrieved "
        "documents at inference time to reduce hallucination."
    ),
    "langgraph": (
        "A library built on LangChain for building stateful, multi-actor "
        "LLM applications as directed graphs."
    ),
    "observability": (
        "The ability to understand a system's internal state from its external "
        "outputs — logs, metrics, and distributed traces."
    ),
    "kafka": (
        "A distributed event streaming platform used for building real-time "
        "data pipelines and stream-processing applications."
    ),
    "react_agent": (
        "ReAct (Reasoning + Acting): an agent that interleaves chain-of-thought "
        "reasoning with tool calls in a loop until a final answer is ready."
    ),
}

_MODEL_BENCHMARKS: dict[str, dict[str, Any]] = {
    "gpt-4o-mini": {"mmlu": 82.0, "context_window": 128_000, "cost_per_1m_input_tokens": 0.15},
    "gpt-4o": {"mmlu": 88.7, "context_window": 128_000, "cost_per_1m_input_tokens": 2.50},
    "claude-3-haiku": {"mmlu": 75.2, "context_window": 200_000, "cost_per_1m_input_tokens": 0.25},
    "gemini-1.5-flash": {"mmlu": 78.9, "context_window": 1_000_000, "cost_per_1m_input_tokens": 0.075},
    "mistral-7b": {"mmlu": 64.2, "context_window": 32_000, "cost_per_1m_input_tokens": 0.20},
}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def get_definition(term: str) -> dict[str, Any]:
    """Look up a definition for a technical AI/ML term (e.g. 'transformer', 'rag', 'observability')."""
    time.sleep(0.2)
    maybe_fail_tool_call("get_definition")
    key = term.lower().replace("-", "_").replace(" ", "_")
    definition = _DEFINITIONS.get(key)
    if definition:
        return {"found": True, "term": term, "definition": definition}
    return {"found": False, "term": term, "error": f"No definition found for '{term}'"}


@tool
def search_papers(topic: str) -> dict[str, Any]:
    """Search the web for papers/articles on a topic (e.g. 'transformer', 'rag', 'react agents')."""
    maybe_fail_tool_call("search_papers")
    if not EXA_API_KEY:
        return {"found": False, "topic": topic, "error": "EXA_API_KEY not set"}
    req = urllib.request.Request(
        "https://api.exa.ai/search",
        data=json.dumps(
            {"query": topic, "type": "auto", "numResults": 5, "contents": {"highlights": True}}
        ).encode(),
        headers={"x-api-key": EXA_API_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        results = json.load(resp).get("results", [])
    papers = [
        {"title": r.get("title"), "url": r.get("url"), "highlights": r.get("highlights")}
        for r in results
    ]
    return {"found": bool(papers), "topic": topic, "count": len(papers), "papers": papers}


@tool
def get_model_benchmarks(model_name: str) -> dict[str, Any]:
    """Get MMLU score, context window, and cost data for a specific LLM."""
    time.sleep(0.2)
    maybe_fail_tool_call("get_model_benchmarks")
    data = _MODEL_BENCHMARKS.get(model_name.lower())
    if data:
        return {"found": True, "model": model_name, **data}
    return {
        "found": False,
        "model": model_name,
        "available_models": list(_MODEL_BENCHMARKS.keys()),
    }


@tool
def calculate(expression: str) -> dict[str, Any]:
    """Evaluate a safe mathematical expression. Supports +, -, *, /, **, sqrt, log, log10, abs, round."""
    time.sleep(0.1)
    maybe_fail_tool_call("calculate")
    _safe_builtins = {
        "sqrt": math.sqrt,
        "log": math.log,
        "log10": math.log10,
        "abs": abs,
        "round": round,
    }
    try:
        result = eval(expression, {"__builtins__": {}}, _safe_builtins)  # noqa: S307
        return {"success": True, "expression": expression, "result": result}
    except Exception as exc:
        return {"success": False, "expression": expression, "error": str(exc)}


TOOLS = configure_example_tools(
    [get_definition, search_papers, get_model_benchmarks, calculate]
)


# ---------------------------------------------------------------------------
# Research queries
# ---------------------------------------------------------------------------


@dataclass
class Query:
    name: str
    question: str
    metadata: dict[str, Any] = field(default_factory=dict)


QUERIES = [
    Query(
        name="Transformer fundamentals",
        question=(
            "What is a transformer in ML? Find the original paper and tell me "
            "how many citations it has."
        ),
        metadata={"query_type": "concept_lookup", "domain": "ml_fundamentals"},
    ),
    Query(
        name="Model cost comparison",
        question=(
            "Compare gpt-4o-mini and gemini-1.5-flash: which has a larger context "
            "window, and what is the cost ratio between them? Calculate the ratio."
        ),
        metadata={"query_type": "model_comparison", "domain": "llm_selection"},
    ),
    Query(
        name="RAG and observability definitions + papers",
        question=(
            "Define RAG and observability simultaneously, then find papers on each "
            "topic. Summarise what you find."
        ),
        metadata={"query_type": "multi_concept", "domain": "ai_engineering"},
    ),
    Query(
        name="ReAct agent research",
        question=(
            "What is a ReAct agent? Find the paper, then look up gpt-4o-mini benchmarks "
            "to understand which model I'd need to run a capable ReAct agent affordably."
        ),
        metadata={"query_type": "agent_research", "domain": "agent_design"},
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------




def make_session_id() -> str:
    return f"research-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    log.info("Starting research agent (model=%s)", MODEL)

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, timeout=60, max_retries=2)
    agent = create_react_agent(llm, TOOLS, prompt=SYSTEM_PROMPT)

    log.info("Processing %d queries", len(QUERIES))

    for query in QUERIES:
        session_id = make_session_id()
        log.info("Query=%r  session=%s", query.name, session_id)
        try:
            result = agent.invoke(
                {"messages": [("user", query.question)]},
                config={"configurable": {"thread_id": session_id}},
            )
            messages = result.get("messages", [])
            answer = messages[-1].content if messages else "(no output)"
            log.info("Query=%r  answer=%s…", query.name, str(answer)[:200])
        except Exception:
            log.exception("Query=%r failed", query.name)

    log.info("All queries processed")


if __name__ == "__main__":
    main()
