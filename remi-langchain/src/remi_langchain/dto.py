from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(slots=True)
class CallbackEventDTO:
    """Data transfer object representing a single callback event.

    Attributes:
        event_type: Short event identifier (e.g., "llm_start", "chain_end").
        data: Arbitrary payload for the event.
    """

    event_type: str
    data: Dict[str, Any] = field(default_factory=dict)