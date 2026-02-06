from __future__ import annotations

import os
from dataclasses import dataclass

try:  # Load environment variables if available
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - optional
    pass


@dataclass(slots=True)
class Settings:
    """Application settings sourced from environment variables.

    Override by setting environment variables, e.g. OPENAI_API_KEY or MODEL_NAME.
    """

    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    model_name: str = os.getenv("MODEL_NAME", "gpt-4o-mini")
    temperature: float = float(os.getenv("TEMPERATURE", "0.0"))
    streaming: bool = os.getenv("STREAMING", "true").lower() in {"1", "true", "yes"}


def get_settings() -> Settings:
    return Settings()