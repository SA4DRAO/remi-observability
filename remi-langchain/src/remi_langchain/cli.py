from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Tuple

from .analyzer import analyze_text
from .callbacks import DataCallbackHandler
from .processing import (
    aggregate_tokens,
    events_to_csv,
    events_to_json,
    generate_summary_report,
)


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


def run_analysis(text: str) -> Tuple[list, str]:
    handler = DataCallbackHandler()
    result = analyze_text(text, callbacks=[handler])
    return handler.events, result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Remi LangChain CLI")
    parser.add_argument("text", nargs="*", help="Text to analyze. If omitted, uses default sample.")
    parser.add_argument("--log-level", default="INFO", help="Logging level (DEBUG, INFO, ...)")
    parser.add_argument("--save-json", default=None, help="Path to save events as JSON")
    parser.add_argument("--save-csv", default=None, help="Path to save events as CSV")
    parser.add_argument("--print-summary", action="store_true", help="Prints summary report")
    parser.add_argument("--print-tokens", action="store_true", help="Print streamed tokens if available")
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)

    setup_logging(args.log_level)

    text = " ".join(args.text) if args.text else "I love how responsive and helpful this product is!"
    events, result = run_analysis(text)

    if args.save_json:
        events_to_json(events, args.save_json)
    if args.save_csv:
        events_to_csv(events, args.save_csv)
    if args.print_summary:
        print(json.dumps(generate_summary_report(events), indent=2))
    if args.print_tokens:
        tokens = aggregate_tokens(events)
        if tokens:
            print("\nTOKENS:\n" + "".join(tokens))

    print("\nResult:", result)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())