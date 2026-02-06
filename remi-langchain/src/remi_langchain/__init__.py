"""Remi LangChain package.

Exports core utilities for callbacks, chains, analyzers, and processing helpers.
"""

from .dto import CallbackEventDTO
from .callbacks import DataCallbackHandler
from .chains import build_offline_chain, build_openai_chain
from .analyzer import analyze_text
from . import processing

__all__ = [
    "CallbackEventDTO",
    "DataCallbackHandler",
    "build_offline_chain",
    "build_openai_chain",
    "analyze_text",
    "processing",
]