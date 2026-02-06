from __future__ import annotations

"""
Thin CLI entrypoint retained for backward compatibility.
The full, production-ready implementation lives under src/remi_langchain.

Usage examples:
  python langchain_test.py "Your text here"
  python -m remi_langchain.cli --help
"""

import sys


def _run():
    try:
        # Defer heavy imports to speed up CLI startup
        from remi_langchain.cli import main
    except Exception as exc:  # pragma: no cover
        print("Failed to load remi_langchain package:", exc)
        sys.exit(1)

    sys.exit(main(sys.argv[1:]))


if __name__ == "__main__":  # pragma: no cover
    _run()