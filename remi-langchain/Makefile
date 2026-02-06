.PHONY: install lint format typecheck test run

install:
	python -m pip install -U pip
	python -m pip install -e .[dev]

lint:
	ruff check .

format:
	black .
	ruff check --fix .

typecheck:
	mypy src

test:
	pytest -q

run:
	python -m remi_langchain.cli --print-summary