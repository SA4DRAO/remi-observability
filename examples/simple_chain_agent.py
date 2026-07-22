"""Simple LCEL chain demo — two-step sequential LLM pipeline.

Demonstrates:
- Pure LangChain Expression Language (LCEL) pipeline: Prompt → LLM → OutputParser
- Pure OTLP instrumentation via zero-code auto-instrumentation (opentelemetry-instrument)
- Two LLM calls per topic (outline + expand) visible as child spans in the trace view
- Conversation grouping: both topics share one conversation_id in the Remi UI

Usage:
    python simple_chain_agent.py
"""
from __future__ import annotations

import logging
import os
import uuid

from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL")  # None → api.openai.com

OUTLINE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a technical content strategist. Return a 5-bullet outline only — no prose."),
    ("human", "Create a {tone} blog post outline about: {topic}"),
])

EXPAND_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a technical writer. Write exactly 3 short paragraphs expanding the outline."),
    ("human", "Expand this outline into a blog post:\n\n{outline}"),
])

TOPICS = [
    {"topic": "The impact of LLM observability in production", "tone": "technical"},
    {"topic": "Why async Python matters for AI backends", "tone": "educational"},
]




def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    log.info("Simple LCEL chain (model=%s)", MODEL)

    parser = StrOutputParser()
    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, timeout=60, max_retries=2)

    for item in TOPICS:
        # One session per topic; BOTH chain invokes share the thread_id, so the
        # outline and expand traces group into a single Remi session.
        session_id = f"simple-chain-{uuid.uuid4().hex[:8]}"
        session_config = {"configurable": {"thread_id": session_id}}
        log.info("topic=%r  session=%s", item["topic"][:50], session_id)

        try:
            outline_chain = OUTLINE_PROMPT | llm | parser
            outline = outline_chain.invoke(
                {"topic": item["topic"], "tone": item["tone"]},
                config=session_config,
            )
            log.info("Outline: %d chars", len(outline))

            expand_chain = EXPAND_PROMPT | llm | parser
            post = expand_chain.invoke({"outline": outline}, config=session_config)
            log.info("Post: %d chars — %s…", len(post), post[:80])

        except Exception:
            log.exception("Chain failed for topic=%r", item["topic"])

    log.info("All topics processed")


if __name__ == "__main__":
    main()
