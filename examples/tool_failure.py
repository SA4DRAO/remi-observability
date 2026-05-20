"""Helpers for injecting intermittent failures into example tool calls."""
from __future__ import annotations

import os
import random
from typing import Any

from langchain_core.tools import ToolException

DEFAULT_TOOL_FAILURE_RATE = 0.1


def _parse_failure_rate(raw_value: str | None) -> float:
    if raw_value is None:
        return DEFAULT_TOOL_FAILURE_RATE
    try:
        rate = float(raw_value)
    except ValueError:
        return DEFAULT_TOOL_FAILURE_RATE
    return min(1.0, max(0.0, rate))


TOOL_FAILURE_RATE = _parse_failure_rate(os.getenv("EXAMPLE_TOOL_FAILURE_RATE"))


def configure_example_tools(tools: list[Any]) -> list[Any]:
    for tool_def in tools:
        tool_def.handle_tool_error = True
    return tools


def maybe_fail_tool_call(tool_name: str) -> None:
    if random.random() >= TOOL_FAILURE_RATE:
        return
    raise ToolException(
        f"Simulated intermittent failure in {tool_name} "
        f"(EXAMPLE_TOOL_FAILURE_RATE={TOOL_FAILURE_RATE:.0%})"
    )