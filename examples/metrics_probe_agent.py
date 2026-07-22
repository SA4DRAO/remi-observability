"""Metrics probe agent — exercises every metric Remi captures, in one session.

One ReAct agent invocation that produces:
- a root workflow span + LLM call spans (llm_calls, tokens, primary_model)
- two tool calls, one of which deliberately fails (tool_calls, tools map, errors)
- a single session grouped by gen_ai.conversation.id

Usage:
    python metrics_probe_agent.py
"""
from __future__ import annotations

import logging
import os
import uuid

from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL")  # None → api.openai.com


@tool
def word_count(text: str) -> int:
    """Count the number of words in the given text."""
    return len(text.split())


@tool
def stock_price(ticker: str) -> str:
    """Look up the current stock price for a ticker symbol."""
    # ponytail: deliberate failure so the session exercises Remi's error metrics
    raise ValueError(f"price feed unavailable for {ticker}")


def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")

    # Both invokes share one thread_id → ONE Remi session exercising every
    # metric: LLM calls, tokens, a successful tool, and an error span.
    session = f"probe-{uuid.uuid4().hex[:8]}"
    session_config = {"configurable": {"thread_id": session}}
    log.info("session=%s model=%s", session, MODEL)

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, temperature=0, timeout=60, max_retries=2)
    agent = create_react_agent(llm, [word_count, stock_price])

    # Happy path: LLM calls + successful tool call.
    result = agent.invoke({
        "messages": [(
            "user",
            "Use word_count on the text 'the quick brown fox jumps over the lazy dog' "
            "and report the count.",
        )]
    }, config=session_config)
    print("\n--- agent answer ---")
    print(result["messages"][-1].content)

    # Error path: the tool raises, the graph aborts — Remi should record
    # an error span and derive session status = error.
    try:
        agent.invoke({"messages": [("user", "Get the stock_price for ticker ACME.")]},
                     config=session_config)
    except Exception as exc:
        log.info("expected failure captured: %s", exc)

    print(f"\nsession id: {session}")


if __name__ == "__main__":
    main()
