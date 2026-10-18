PYTHON ?= .venv/bin/python
.PHONY: install check export package dev
install:
	python3.14 -m venv .venv
	$(PYTHON) -m pip install -c requirements.lock -e '.[dev]'
check:
	$(PYTHON) -m ruff check .
	$(PYTHON) -m ruff format --check .
	$(PYTHON) -m pytest -q
export:
	$(PYTHON) -m api.export
package:
	$(PYTHON) build_lambda.py
dev:
	$(PYTHON) -m uvicorn api.local:create_app --factory --host 127.0.0.1 --port 8000
