"""Simple LCEL chain demo — two-step sequential LLM pipeline.

Demonstrates:
- Pure LangChain Expression Language (LCEL) pipeline: Prompt → LLM → OutputParser
- Remi observability via RemiCallback (no external instrumentation package needed)
- Two LLM calls per topic (outline + expand) visible as child spans in the trace view

Usage:
    python simple_chain_agent.py
"""
from __future__ import annotations

import logging
import os
import uuid

import httpx
from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from otel_setup import configure_otel, make_callback, set_session_id, set_conversation_id

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

BACKEND_URL = os.getenv("REMI_BACKEND_URL", "http://localhost:3100")
ORG_ID = os.getenv("REMI_ORG_ID") or "demo-org"
AGENT_ID = os.getenv("REMI_AGENT_ID") or "simple-chain"
AGENT_VERSION = os.getenv("REMI_AGENT_VERSION", "v1")
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

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


def check_backend_health() -> bool:
    try:
        r = httpx.get(f"{BACKEND_URL}/health", timeout=5.0)
        ok = r.status_code == 200
        log.info("Backend health: %s", "OK" if ok else "FAIL")
        return ok
    except Exception as exc:
        log.error("Backend unreachable: %s", exc)
        return False


def main() -> None:
    log.info("Simple LCEL chain (backend=%s, model=%s, org=%s)", BACKEND_URL, MODEL, ORG_ID)

    if not check_backend_health():
        log.warning("Backend unreachable — spans may not reach Remi")

    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID, service_version=AGENT_VERSION)
    parser = StrOutputParser()

    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, api_key=openai_api_key)

    try:
        for item in TOPICS:
            session_id = f"simple-chain-{uuid.uuid4().hex[:8]}"
            log.info("topic=%r  session=%s", item["topic"][:50], session_id)
            set_session_id(session_id)

            cb = make_callback(tracer)

            try:
                with tracer.start_as_current_span(
                    "RunnableSequence",
                    attributes={
                        "remi.session_id": session_id,
                        "remi.org_id": ORG_ID,
                        "remi.agent_id": AGENT_ID,
                    },
                ):
                    outline_chain = OUTLINE_PROMPT | llm | parser
                    outline = outline_chain.invoke(
                        {"topic": item["topic"], "tone": item["tone"]},
                        config={"callbacks": [cb]},
                    )
                    log.info("Outline: %d chars", len(outline))

                    expand_chain = EXPAND_PROMPT | llm | parser
                    post = expand_chain.invoke(
                        {"outline": outline},
                        config={"callbacks": [cb]},
                    )
                    log.info("Post: %d chars — %s…", len(post), post[:80])

            except Exception:
                log.exception("Chain failed for topic=%r", item["topic"])

        log.info("All topics processed")
    finally:
        log.info("Flushing spans…")
        tracer_provider.shutdown()
        log.info("Done")


if __name__ == "__main__":
    main()
