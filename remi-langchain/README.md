# remi-langchain

Production-ready LangChain utilities and CLI to analyze text sentiment with structured callback capture and processing utilities.

## Features
- Modular package structure (callbacks, chains, analyzer, processing)
- Structured events (DTO) with timestamps
- Offline deterministic chain for tests
- OpenAI-backed chain when `OPENAI_API_KEY` is set
- CLI with logging, JSON/CSV export, and summary reporting
- Packaging via `pyproject.toml`, dev tooling (ruff, black, mypy, pytest)
- Docker image for deployment

## Quickstart

- Install (dev):
  make install

- Run CLI:
  python -m remi_langchain.cli --print-summary "I love how responsive and helpful this product is!"

- Save events:
  python -m remi_langchain.cli --save-json events.json --save-csv events.csv "Great UX!"

## Environment
Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to use OpenAI models; otherwise offline mode is used.

## Docker
Build and run:

- Build: `docker build -t remi-langchain:latest .`
- Run: `docker run --rm -e OPENAI_API_KEY=... remi-langchain:latest --print-summary "Your text"`

## Library Usage

```python
from remi_langchain import analyze_text, DataCallbackHandler

handler = DataCallbackHandler()
result = analyze_text("Text here", callbacks=[handler])
print(result)
```

## Tests

- Run tests: `make test`

## License
MIT