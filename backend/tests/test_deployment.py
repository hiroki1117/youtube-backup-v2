import importlib
from unittest.mock import patch

import pytest

from api.deployment import CHECK_EVENT, deployment_entrypoint
from build_lambda import HANDLERS


@pytest.mark.parametrize("function,entrypoint", HANDLERS.items())
def test_all_packaged_entrypoints_fail_closed_before_any_aws(function, entrypoint, monkeypatch):
    monkeypatch.delenv("BACKEND_EXECUTION_MODE", raising=False)
    module, name = entrypoint.rsplit(".", 1)
    # Import and invoke with every boto3/network entrypoint forbidden, no resource envs needed.
    with (
        patch("boto3.Session", side_effect=AssertionError("AWS session created")),
        patch("socket.socket", side_effect=AssertionError("Network attempted")),
    ):
        handler = getattr(importlib.import_module(module), name)
        assert handler(CHECK_EVENT, None) == {
            "status": "ok",
            "function": function,
            "execution_mode": "validation",
            "aws_access": False,
        }
        for event in (
            {},
            {"Records": []},
            {"operation": "deployment_check", "mode": "application"},
        ):
            with pytest.raises(RuntimeError, match="disabled"):
                handler(event, None)
        monkeypatch.setenv("BACKEND_EXECUTION_MODE", "validation")
        assert handler(CHECK_EVENT, None)["status"] == "ok"
        monkeypatch.setenv("BACKEND_EXECUTION_MODE", "typo")
        with pytest.raises(RuntimeError, match="Invalid"):
            handler(CHECK_EVENT, None)


def test_application_mode_delegates_without_changing_event_or_context(monkeypatch):
    monkeypatch.setenv("BACKEND_EXECUTION_MODE", "application")
    calls = []

    @deployment_entrypoint("example")
    def handler(event, context):
        calls.append((event, context))
        return {"delegated": True}

    assert handler({"input": True}, "context") == {"delegated": True}
    assert calls == [({"input": True}, "context")]
    assert handler(CHECK_EVENT, None)["execution_mode"] == "application"
    assert len(calls) == 1


def test_received_artifact_hash_and_clean_source_are_required(tmp_path):
    import base64
    import hashlib
    import json

    from verify_lambda import verify

    archive = tmp_path / "video.zip"
    archive.write_bytes(b"tampered artifact")
    original = hashlib.sha256(b"original artifact").digest()
    manifest = {
        "schema_version": 1,
        "function": "video",
        "artifact": "video.zip",
        "handler": HANDLERS["video"],
        "runtime": "python3.14",
        "architecture": "x86_64",
        "execution_mode": "validation",
        "source_tree_dirty": False,
        "sha256": original.hex(),
        "code_sha256": base64.b64encode(original).decode(),
    }
    path = tmp_path / "video.manifest.json"
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="SHA256 mismatch"):
        verify(path)
    manifest["source_tree_dirty"] = True
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="uncommitted"):
        verify(path, require_clean=True)
