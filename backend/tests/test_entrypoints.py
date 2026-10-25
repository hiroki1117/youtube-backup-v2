import importlib
import subprocess
import sys

import pytest

from build_lambda import HANDLERS


def load(path):
    module, name = path.rsplit(".", 1)
    return getattr(importlib.import_module(module), name)


@pytest.mark.parametrize("path", HANDLERS.values())
def test_every_lambda_handler_is_importable_and_callable(path):
    assert callable(load(path))


@pytest.mark.parametrize("name", ["s3_complete", "scrapbox_scan", "retry", "youtube_comments"])
def test_event_lambdas_do_not_load_the_web_stack(name):
    # Event Lambdas must stay free of the HTTP framework: a cold start imports only their own path.
    code = (
        "import sys, importlib; "
        f"importlib.import_module('entrypoints.{name}'); "
        "loaded = [m for m in ('fastapi', 'starlette', 'mangum') if m in sys.modules]; "
        "assert not loaded, loaded"
    )
    subprocess.run([sys.executable, "-c", code], check=True)


@pytest.mark.parametrize(
    ("name", "present", "absent"),
    [
        ("video", "/videos", "/videos/{video_id}/backup"),
        ("backup", "/videos/{video_id}/backup", "/videos"),
        ("comments", "/videos/{video_id}/comments", "/videos/{video_id}/backup"),
    ],
)
def test_api_lambdas_mount_only_their_own_resource(name, present, absent):
    paths = set(load(HANDLERS[name]).app.openapi()["paths"])
    assert present in paths
    assert absent not in paths
