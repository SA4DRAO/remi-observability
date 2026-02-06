from __future__ import annotations

import csv
import json
from collections import Counter
from typing import Any, Callable, Dict, Iterable, List

from .dto import CallbackEventDTO


# 1) Conversion & Serialization
def events_to_dict(events: Iterable[CallbackEventDTO]) -> List[Dict[str, Any]]:
    """Convert dataclass events to plain dictionaries."""

    return [e.__dict__ for e in events]


def events_to_json(events: Iterable[CallbackEventDTO], filename: str = "events.json") -> None:
    """Write events to a JSON file."""

    with open(filename, "w", encoding="utf-8") as f:
        json.dump(events_to_dict(list(events)), f, indent=2, ensure_ascii=False)


def events_to_csv(events: Iterable[CallbackEventDTO], filename: str = "events.csv") -> None:
    """Write events to a CSV file, flattening `data` fields."""

    dicts = events_to_dict(list(events))
    # Collect keys from top-level and nested data
    keys: set[str] = set()
    for d in dicts:
        keys.update(d.keys())
        if isinstance(d.get("data"), dict):
            keys.update(d["data"].keys())
    fieldnames = sorted(keys)

    with open(filename, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for d in dicts:
            row = {**d, **(d.get("data") or {})}
            writer.writerow(row)


def load_events_from_json(filename: str = "events.json") -> List[Dict[str, Any]]:
    """Load events previously saved as JSON. Returns list of dicts."""

    with open(filename, "r", encoding="utf-8") as f:
        return json.load(f)


# 2) Filtering
def filter_events_by_type(events: Iterable[CallbackEventDTO], event_type: str) -> List[CallbackEventDTO]:
    return [e for e in events if e.event_type == event_type]


def filter_events_by_keyword(events: Iterable[CallbackEventDTO], keyword: str) -> List[CallbackEventDTO]:
    kw = keyword.lower()
    return [e for e in events if kw in json.dumps(e.data, ensure_ascii=False).lower()]


# 3) Aggregation & Counting
def count_events_by_type(events: Iterable[CallbackEventDTO]) -> Dict[str, int]:
    return dict(Counter(e.event_type for e in events))


def aggregate_tokens(events: Iterable[CallbackEventDTO]) -> List[str]:
    return [e.data["token"] for e in events if e.event_type == "llm_new_token" and "token" in e.data]


def summarize_usage(events: Iterable[CallbackEventDTO]) -> List[Dict[str, Any]]:
    usages: List[Dict[str, Any]] = []
    for e in events:
        if e.event_type == "llm_end":
            usage = e.data.get("usage")
            if usage is not None:
                usages.append(usage)
    return usages


# 4) Extraction
def extract_model_names(events: Iterable[CallbackEventDTO]) -> List[str]:
    return [str(e.data.get("model")) for e in events if "model" in e.data]


def extract_errors(events: Iterable[CallbackEventDTO]) -> List[str]:
    return [str(e.data["error"]) for e in events if "error" in e.data]


# 5) Transformation
def flatten_events(events: Iterable[CallbackEventDTO]) -> List[Dict[str, Any]]:
    return [{**e.__dict__, **(e.data or {})} for e in events]


def map_events(events: Iterable[CallbackEventDTO], fn: Callable[[CallbackEventDTO], Any]) -> List[Any]:
    return [fn(e) for e in events]


# 6) Analysis
def analyze_sentiment_results(events: Iterable[CallbackEventDTO]) -> List[Any]:
    # Collect outputs from chain_end events
    results: List[Any] = []
    for e in events:
        if e.event_type == "chain_end":
            if "outputs" in e.data:
                results.append(e.data["outputs"])
    return results


def track_chain_execution(events: Iterable[CallbackEventDTO]) -> List[Dict[str, Any]]:
    # Provide chain name and event type timeline
    timeline: List[Dict[str, Any]] = []
    for e in events:
        if "chain" in e.data or e.event_type in {"chain_start", "chain_end"}:
            timeline.append({
                "ts": e.data.get("ts"),
                "event_type": e.event_type,
                "chain": e.data.get("chain"),
            })
    return timeline


# 7) Reporting
def generate_summary_report(events: Iterable[CallbackEventDTO]) -> Dict[str, Any]:
    ev_list = list(events)
    report: Dict[str, Any] = {
        "total_events": len(ev_list),
        "event_types": count_events_by_type(ev_list),
        "errors": extract_errors(ev_list),
        "model_names": list({m for m in extract_model_names(ev_list) if m}),
    }
    return report


def print_event_log(events: Iterable[CallbackEventDTO]) -> None:
    for e in events:
        print(f"{e.event_type}: {e.data}")


# 8) Integration (example stub)
def send_events_to_database(events: Iterable[CallbackEventDTO], db_insert_func: Callable[[Dict[str, Any]], None]) -> None:
    for e in events:
        db_insert_func(e.__dict__)