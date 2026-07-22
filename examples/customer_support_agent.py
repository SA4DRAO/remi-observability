"""Customer support agent — a fully isolated production-style LangChain agent.

There is ZERO observability code in this file. Tracing comes entirely from the
zero-code launcher (`opentelemetry-instrument`, configured by OTEL_* env vars),
and session identity comes from LangGraph's own `thread_id` — the same key
production apps already pass for checkpointing — which the instrumentation maps
to the standard `gen_ai.conversation.id` attribute Remi groups sessions by.

Usage:
    OTEL_SERVICE_NAME=support-agent opentelemetry-instrument python customer_support_agent.py
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

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

# ---------------------------------------------------------------------------
# Configuration — plain provider env vars; ChatOpenAI reads OPENAI_API_KEY itself.
# Route via OpenRouter (or any OpenAI-compatible gateway) by setting
# OPENAI_BASE_URL + OPENAI_MODEL; org identity lives in the OTLP ingest key.
# ---------------------------------------------------------------------------
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.getenv("OPENAI_BASE_URL")  # None → api.openai.com

SYSTEM_PROMPT = """\
You are a senior customer support agent with access to a database of customer
records, order history, support issues, discounts, and email tools.

When you need information, call ALL relevant tools in a single response (parallel
tool calls). For example, to investigate a customer: call lookup_customer,
get_order_history and check_issue_history simultaneously.

After gathering data, decide whether to apply a discount or send an email, then
produce a clear, professional summary for the support team.
"""

# ---------------------------------------------------------------------------
# Simulated databases
# ---------------------------------------------------------------------------
_CUSTOMERS: dict[str, dict[str, Any]] = {
    "CUST001": {"name": "Alice Johnson", "email": "alice@example.com", "tier": "premium", "balance": 250.00},
    "CUST002": {"name": "Bob Smith", "email": "bob@example.com", "tier": "standard", "balance": 45.50},
    "CUST003": {"name": "Carol White", "email": "carol@example.com", "tier": "basic", "balance": 0.00},
}

_ORDERS: dict[str, list[dict[str, Any]]] = {
    "CUST001": [
        {"order_id": "ORD-2026-001", "date": "2026-02-03", "total": 89.99, "status": "shipped", "items": ["Widget Pro", "Gadget Plus"]},
        {"order_id": "ORD-2026-002", "date": "2026-02-05", "total": 124.50, "status": "pending", "items": ["Premium Service (1yr)"]},
    ],
    "CUST002": [
        {"order_id": "ORD-2026-003", "date": "2026-02-01", "total": 45.50, "status": "delivered", "items": ["Basic Tool"]},
    ],
    "CUST003": [],
}

_ISSUES: dict[str, list[dict[str, Any]]] = {
    "CUST001": [
        {"issue_id": "ISS-001", "subject": "Shipping delay on ORD-2026-001", "open": False, "resolved_date": "2026-02-04"},
        {"issue_id": "ISS-003", "subject": "Billing discrepancy on ORD-2026-002", "open": True, "created_date": "2026-02-10"},
    ],
    "CUST002": [
        {"issue_id": "ISS-002", "subject": "Question about warranty", "open": True, "created_date": "2026-02-06"},
    ],
    "CUST003": [],
}

# ---------------------------------------------------------------------------
# LangChain tools — @tool decorator gives us schemas for free
# ---------------------------------------------------------------------------


@tool
def lookup_customer(customer_id: str) -> dict[str, Any]:
    """Look up a customer record by ID (e.g. CUST001)."""
    time.sleep(0.3)
    maybe_fail_tool_call("lookup_customer")
    c = _CUSTOMERS.get(customer_id)
    if not c:
        return {"found": False, "error": f"Customer {customer_id} not found"}
    return {"found": True, "customer_id": customer_id, **c}


@tool
def get_order_history(customer_id: str) -> dict[str, Any]:
    """Return all orders placed by a customer."""
    time.sleep(0.4)
    maybe_fail_tool_call("get_order_history")
    orders = _ORDERS.get(customer_id)
    if orders is None:
        return {"found": False, "error": f"No order records for {customer_id}"}
    return {
        "found": True,
        "customer_id": customer_id,
        "order_count": len(orders),
        "total_spent": round(sum(o["total"] for o in orders), 2),
        "orders": orders,
    }


@tool
def check_issue_history(customer_id: str) -> dict[str, Any]:
    """Return the support issue history for a customer."""
    time.sleep(0.3)
    maybe_fail_tool_call("check_issue_history")
    issues = _ISSUES.get(customer_id)
    if issues is None:
        return {"found": False, "error": f"No issue records for {customer_id}"}
    open_issues = [i for i in issues if i.get("open")]
    return {
        "found": True,
        "customer_id": customer_id,
        "total_issues": len(issues),
        "open_issue_count": len(open_issues),
        "open_issues": open_issues,
        "all_issues": issues,
    }


@tool
def apply_discount(customer_id: str, discount_percentage: int) -> dict[str, Any]:
    """Apply a discount credit (1-50%) to a customer account balance."""
    time.sleep(0.3)
    maybe_fail_tool_call("apply_discount")
    if customer_id not in _CUSTOMERS:
        return {"success": False, "error": f"Customer {customer_id} not found"}
    if not (0 < discount_percentage <= 50):
        return {"success": False, "error": "Discount must be 1-50%"}
    credit = round(_CUSTOMERS[customer_id]["balance"] * (discount_percentage / 100), 2)
    _CUSTOMERS[customer_id]["balance"] = round(_CUSTOMERS[customer_id]["balance"] + credit, 2)
    return {
        "success": True,
        "customer_id": customer_id,
        "discount_percentage": discount_percentage,
        "credit_applied": credit,
        "new_balance": _CUSTOMERS[customer_id]["balance"],
    }


@tool
def send_followup_email(customer_id: str, subject: str, body: str = "") -> dict[str, Any]:
    """Send a follow-up email to the customer."""
    time.sleep(0.5)
    maybe_fail_tool_call("send_followup_email")
    c = _CUSTOMERS.get(customer_id)
    if not c:
        return {"success": False, "error": f"Customer {customer_id} not found"}
    return {
        "success": True,
        "to": c["email"],
        "subject": subject,
        "preview": body[:120] if body else "(no body)",
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }


TOOLS = configure_example_tools(
    [lookup_customer, get_order_history, check_issue_history, apply_discount, send_followup_email]
)

# ---------------------------------------------------------------------------
# Support ticket scenarios
# ---------------------------------------------------------------------------


@dataclass
class Ticket:
    name: str
    customer_id: str
    description: str
    metadata: dict[str, Any] = field(default_factory=dict)


TICKETS = [
    Ticket(
        name="CUST001 - Billing discrepancy + compensation",
        customer_id="CUST001",
        description=(
            "Premium customer Alice Johnson has an open billing issue on ORD-2026-002. "
            "Investigate her account, orders and issues. If she has an open issue apply a 10% "
            "discount and send a professional apology email."
        ),
        metadata={"ticket_type": "billing", "priority": "high"},
    ),
    Ticket(
        name="CUST002 - Warranty question",
        customer_id="CUST002",
        description=(
            "Standard customer Bob Smith has an open warranty question. "
            "Look up his account, orders and issues in one go. "
            "Send him an email explaining our 12-month warranty policy."
        ),
        metadata={"ticket_type": "warranty", "priority": "medium"},
    ),
    Ticket(
        name="CUST003 - New account onboarding",
        customer_id="CUST003",
        description=(
            "New basic-tier customer Carol White has contacted support. "
            "Check her account, orders and issues simultaneously. "
            "Send a warm welcome / onboarding email encouraging her first purchase."
        ),
        metadata={"ticket_type": "onboarding", "priority": "low"},
    ),
]

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set")
    log.info("Starting customer support agent (model=%s)", MODEL)

    # Build the LangChain agent once — tools and model are fixed for the run.
    llm = ChatOpenAI(model=MODEL, base_url=BASE_URL, timeout=60, max_retries=2)
    agent = create_react_agent(llm, TOOLS, prompt=SYSTEM_PROMPT)

    log.info("Processing %d tickets", len(TICKETS))

    for ticket in TICKETS:
        # thread_id is the ONLY session plumbing: LangGraph's own conversation
        # key, mapped by the instrumentation to gen_ai.conversation.id, which
        # Remi groups sessions by. Reuse an id across invokes for multi-turn.
        session_id = f"support-{uuid.uuid4().hex[:8]}"
        log.info("Ticket=%r  session=%s", ticket.name, session_id)
        try:
            result = agent.invoke(
                {"messages": [("user", ticket.description)]},
                config={"configurable": {"thread_id": session_id}},
            )
            final_messages = result.get("messages", [])
            final_text = final_messages[-1].content if final_messages else "(no output)"
            log.info("Ticket=%s  done  response=%s", ticket.name, str(final_text)[:200])
        except Exception:
            log.exception("Ticket=%s failed", ticket.name)

    log.info("All tickets processed")


if __name__ == "__main__":
    main()
