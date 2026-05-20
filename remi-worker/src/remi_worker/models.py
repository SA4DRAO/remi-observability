"""Validation helpers for raw Kafka event messages consumed by remi-worker."""

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Fields that must be present and non-empty in every event message.
_REQUIRED_STRING_FIELDS = ("session_id", "event_type")


def validate_kafka_event(raw: Dict[str, Any]) -> None:
    """Validate the structure of a raw Kafka event dict.

    Raises:
        ValueError: if required fields are absent, empty, or have the wrong type.

    Callers should catch ``ValueError``, log the raw payload to the dead-letter
    log, and skip the message rather than adding it to the batch.  The Kafka
    offset for the rejected message will be committed with the next successful
    batch flush — the message is intentionally not reprocessed.

    Validated constraints:
    - ``session_id``: non-empty string
    - ``event_type``: non-empty string
    - ``_seq``: if present, must be a non-negative integer (not a bool)
    """
    for field in _REQUIRED_STRING_FIELDS:
        value = raw.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"missing or empty required field '{field}': got {value!r}"
            )

    seq = raw.get("_seq")
    if seq is not None:
        # Bools are a subclass of int in Python; reject them explicitly.
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 0:
            raise ValueError(
                f"'_seq' must be a non-negative integer: got {seq!r} ({type(seq).__name__})"
            )
