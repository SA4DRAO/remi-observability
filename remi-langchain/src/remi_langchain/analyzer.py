from __future__ import annotations

from typing import List, Optional

from langchain_core.callbacks import BaseCallbackHandler

from .callbacks import DataCallbackHandler
from .chains import build_offline_chain, build_openai_chain
from .config import Settings, get_settings


def analyze_text(
    text: str,
    callbacks: Optional[List[BaseCallbackHandler]] = None,
    settings: Optional[Settings] = None,
) -> str:
    """Analyze text using either OpenAI-backed chain or offline fallback.

    Args:
        text: Input text to analyze.
        callbacks: Optional list of callback handlers. Defaults to a `DataCallbackHandler`.
        settings: Optional settings object. If omitted, loaded from environment.

    Returns:
        The parsed LLM output string.
    """

    settings = settings or get_settings()
    callbacks = callbacks or [DataCallbackHandler()]

    has_key = bool(settings.openai_api_key)
    chain = (
        build_openai_chain(settings.model_name, settings.temperature, settings.streaming)
        if has_key
        else build_offline_chain()
    )

    return chain.invoke({"text": text}, config={"callbacks": callbacks})