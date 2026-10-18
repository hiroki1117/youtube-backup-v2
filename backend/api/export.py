import json
from pathlib import Path

from api.app import app

if __name__ == "__main__":
    destination = Path(__file__).resolve().parents[2] / "openapi" / "openapi.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n")
