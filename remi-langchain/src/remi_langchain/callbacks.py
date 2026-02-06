from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from langchain_core.callbacks import BaseCallbackHandler

from .dto import CallbackEventDTO


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DataCallbackHandler(BaseCallbackHandler):
    """Callback handler that stores events in `CallbackEventDTO` instances.

    This avoids printing to stdout and makes the data programmatically consumable.
    Each event will include an ISO-8601 UTC timestamp under the `ts` key in `data`.
    """

    def __init__(self) -> None:
        self.events: List[CallbackEventDTO] = []

    def _extract_name(self, serialized: Optional[Dict[str, Any]]) -> str:
        try:
            if isinstance(serialized, dict):
                name = serialized.get("name")
                if name:
                    return str(name)
                id_val = serialized.get("id")
                if isinstance(id_val, dict):
                    name = id_val.get("name")
                    if name:
                        return str(name)
                if id_val is not None:
                    return str(id_val)
            return type(serialized).__name__
        except Exception:
            return "unknown"

    # Chain events
    def on_chain_start(self, serialized: Dict[str, Any], inputs: Dict[str, Any], **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(
                event_type="chain_start",
                data={
                    "ts": _now_iso(),
                    "chain": self._extract_name(serialized),
                    "inputs": inputs,
                    "serialized": serialized,
                },
            )
        )

    def on_chain_end(self, outputs: Dict[str, Any], **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="chain_end", data={"ts": _now_iso(), "outputs": outputs})
        )

    def on_chain_error(self, error: Exception, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="chain_error", data={"ts": _now_iso(), "error": str(error)})
        )

    # LLM events
    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(
                event_type="llm_start",
                data={
                    "ts": _now_iso(),
                    "llm": self._extract_name(serialized),
                    "prompts": prompts,
                    "serialized": serialized,
                },
            )
        )

    def on_llm_new_token(self, token: str, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="llm_new_token", data={"ts": _now_iso(), "token": token})
        )

    def on_llm_end(self, response: Any, **_: Any) -> None:
        usage = None
        try:
            llm_output = getattr(response, "llm_output", None) or {}
            if isinstance(llm_output, dict):
                usage = llm_output.get("token_usage") or llm_output.get("usage")
        except Exception:
            pass
        self.events.append(
            CallbackEventDTO(
                event_type="llm_end",
                data={"ts": _now_iso(), "response": response, "usage": usage},
            )
        )

    def on_llm_error(self, error: Exception, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="llm_error", data={"ts": _now_iso(), "error": str(error)})
        )

    # Chat model
    def on_chat_model_start(self, serialized: Dict[str, Any], messages: List[List[Any]], **_: Any) -> None:
        first = messages[0][0] if messages and messages[0] else None
        content = getattr(first, "content", None)
        self.events.append(
            CallbackEventDTO(
                event_type="chat_model_start",
                data={
                    "ts": _now_iso(),
                    "model": self._extract_name(serialized),
                    "msg_batches": len(messages),
                    "first_message_content": content,
                    "serialized": serialized,
                },
            )
        )

    # Tools
    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(
                event_type="tool_start",
                data={
                    "ts": _now_iso(),
                    "tool": self._extract_name(serialized),
                    "input": input_str,
                    "serialized": serialized,
                },
            )
        )

    def on_tool_end(self, output: str, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="tool_end", data={"ts": _now_iso(), "output": output})
        )

    def on_tool_error(self, error: Exception, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="tool_error", data={"ts": _now_iso(), "error": str(error)})
        )

    # Retrieval
    def on_retriever_start(self, serialized: Dict[str, Any], query: str, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(
                event_type="retriever_start",
                data={
                    "ts": _now_iso(),
                    "retriever": self._extract_name(serialized),
                    "query": query,
                    "serialized": serialized,
                },
            )
        )

    def on_retriever_end(self, documents: Any, **_: Any) -> None:
        count = len(documents) if hasattr(documents, "__len__") else "unknown"
        self.events.append(
            CallbackEventDTO(
                event_type="retriever_end",
                data={"ts": _now_iso(), "docs_count": count, "documents": documents},
            )
        )

    def on_retriever_error(self, error: Exception, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(
                event_type="retriever_error", data={"ts": _now_iso(), "error": str(error)}
            )
        )

    # Agent
    def on_agent_action(self, action: Any, **_: Any) -> None:
        tool = getattr(action, "tool", None)
        tool_input = getattr(action, "tool_input", None)
        log = getattr(action, "log", None)
        self.events.append(
            CallbackEventDTO(
                event_type="agent_action",
                data={"ts": _now_iso(), "tool": tool, "tool_input": tool_input, "log": log},
            )
        )

    def on_agent_finish(self, finish: Any, **_: Any) -> None:
        return_values = getattr(finish, "return_values", None)
        self.events.append(
            CallbackEventDTO(
                event_type="agent_finish", data={"ts": _now_iso(), "return_values": return_values}
            )
        )

    # Generic text
    def on_text(self, text: str, **_: Any) -> None:
        self.events.append(
            CallbackEventDTO(event_type="text", data={"ts": _now_iso(), "text": text})
        )