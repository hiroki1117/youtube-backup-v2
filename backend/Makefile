PYTHON ?= .venv/bin/python
FUNCTION ?= video
.PHONY: install check legacy-check export package verify dev
install:
	python3.14 -m venv .venv
	$(PYTHON) -m pip install -c requirements.lock -e '.[dev]'
check:
	$(PYTHON) -m ruff check .
	$(PYTHON) -m ruff format --check .
	$(PYTHON) -m pytest -q
	$(MAKE) legacy-check
legacy-check:
	$(PYTHON) -c 'import ast,pathlib; files=list(pathlib.Path("lambda").glob("*/main.py")); assert len(files)==9; [ast.parse(p.read_text()) for p in files]'
export:
	$(PYTHON) -m api.export
package:
	$(PYTHON) build_lambda.py $(FUNCTION)
verify:
	$(PYTHON) verify_lambda.py build/$(FUNCTION).manifest.json
dev:
	$(PYTHON) -m uvicorn api.local:create_app --factory --host 127.0.0.1 --port 8000
