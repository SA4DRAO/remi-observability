"""Package entry point – ``python -m remi_worker`` runs the worker."""

import asyncio

from .consumer import main
from .telemetry import setup_tracing


def run() -> None:
    setup_tracing()
    asyncio.run(main())


if __name__ == "__main__":
    run()
