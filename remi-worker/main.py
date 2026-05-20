"""Backward-compatibility shim – the preferred entry point is ``python -m remi_worker``.

This file is kept so that ``python main.py`` continues to work locally.
The actual implementation lives in src/remi_worker/.
"""
import os
import sys

# Make the src/ layout importable when running from the project root directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from remi_worker.__main__ import run  # type: ignore[import-not-found]  # noqa: E402

run()  # blocks until the worker shuts down, then exits
