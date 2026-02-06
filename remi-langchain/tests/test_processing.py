from __future__ import annotations

from remi_langchain.dto import CallbackEventDTO
from remi_langchain.processing import count_events_by_type, events_to_dict, extract_errors


def test_basic_processing():
    events = [
        CallbackEventDTO(event_type="chain_start", data={"ts": "2024-01-01T00:00:00Z"}),
        CallbackEventDTO(event_type="llm_new_token", data={"token": "Hello", "ts": "2024-01-01T00:00:01Z"}),
        CallbackEventDTO(event_type="llm_end", data={"usage": {"input_tokens": 1}, "ts": "2024-01-01T00:00:02Z"}),
        CallbackEventDTO(event_type="llm_error", data={"error": "Boom", "ts": "2024-01-01T00:00:03Z"}),
    ]

    d = events_to_dict(events)
    assert isinstance(d, list) and isinstance(d[0], dict)

    counts = count_events_by_type(events)
    assert counts["llm_new_token"] == 1

    errs = extract_errors(events)
    assert errs == ["Boom"]