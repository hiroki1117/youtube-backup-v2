import importlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.app import app, create_app
from api.dependencies import get_service
from api.factory import build_app
from api.routes import backup_router, comment_router, video_router
from build_lambda import HANDLERS
from entrypoints.backup import handler as backup_handler
from entrypoints.comments import handler as comments_handler
from entrypoints.video import handler as video_handler

URL = "https://www.youtube.com/watch?v=abcdefghijk"


def test_register_read_update_and_duplicate(client, service):
    response = client.post("/videos", json={"url": URL})
    assert response.status_code == 202
    assert response.json()["video"]["video_id"] == "abcdefghijk"
    assert service.jobs.submissions == 1
    duplicate = client.post("/videos", json={"url": URL})
    assert duplicate.status_code == 200
    assert duplicate.json()["already_registered"] is True
    assert service.jobs.submissions == 1
    assert client.get("/videos/abcdefghijk").status_code == 200
    assert client.patch("/videos/abcdefghijk", json={"title": "Edited"}).json()["title"] == "Edited"
    assert client.patch("/videos/abcdefghijk", json={"title": "  Trim  "}).json()["title"] == "Trim"
    assert len(client.get("/videos?upload_status=init").json()) == 1
    assert client.get("/videos/abcdefghijk/backup").json()["state"] == "submitted"
    assert client.post("/videos/abcdefghijk/backup").status_code == 200
    assert service.jobs.submissions == 1
    assert client.get("/videos/abcdefghijk/playback_url").status_code == 409
    # An unfinished video is not deleted; its backup is cancelled instead.
    assert client.delete("/videos/abcdefghijk").status_code == 409
    job_id = service.video("abcdefghijk")["batch_job_id"]
    assert client.delete("/videos/abcdefghijk/backup").status_code == 204
    assert service.jobs.items[job_id]["status"] == "FAILED"
    assert client.get("/videos/abcdefghijk").status_code == 404
    assert client.delete("/videos/abcdefghijk/backup").status_code == 404


def test_completed_playback_and_delete(client, service):
    client.post("/videos", json={"url": URL})
    service.videos.items["abcdefghijk"]["upload_status"] = "complete"
    response = client.get("/videos/abcdefghijk/playback_url")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["expires_in"] == 3600
    assert client.post("/videos/abcdefghijk/backup").json()["state"] == "complete"
    assert service.jobs.submissions == 1
    assert client.delete("/videos/abcdefghijk").status_code == 204
    assert client.get("/videos/abcdefghijk").status_code == 404


def test_input_and_not_found(client):
    for body in [
        {},
        {"url": "bad"},
        {"url": "https://youtu.be/bad"},
        {"url": URL, "unexpected": 1},
        {"url": "https://x.com/u/status/123"},
    ]:
        assert client.post("/videos", json=body).status_code == 422
    assert client.get("/videos?fetch_num=0").status_code == 422
    assert client.get("/videos?upload_status=failed").status_code == 422
    assert client.get("/videos/missing").status_code == 404
    assert client.patch("/videos/missing", json={"title": ""}).status_code == 422
    assert client.patch("/videos/missing", json={"title": "   "}).status_code == 422
    assert client.post("/videos/missing/backup").status_code == 404


def test_fail_closed_without_token_or_gateway(monkeypatch):
    monkeypatch.delenv("BACKEND_LOCAL_TOKEN", raising=False)
    with patch("boto3.Session", side_effect=AssertionError("AWS contacted before authorization")):
        with TestClient(create_app()) as client:
            assert client.get("/videos").status_code == 401
        # Import all entrypoints under a factory that forbids any AWS initialization.
        importlib.reload(importlib.import_module("api.app"))
        for path in HANDLERS.values():
            importlib.reload(importlib.import_module(path.rsplit(".", 1)[0]))


def gateway_event(path, claims=None):
    event = {
        "version": "2.0",
        "routeKey": "GET " + path,
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"host": "api.test.invalid"},
        "requestContext": {
            "http": {"method": "GET", "path": path, "sourceIp": "127.0.0.1", "protocol": "HTTP/1.1"}
        },
        "isBase64Encoded": False,
    }
    if claims:
        event["requestContext"]["authorizer"] = {"jwt": {"claims": claims}}
    return event


def test_lambda_authorizer_and_resource_split(service, monkeypatch):
    monkeypatch.setenv("BACKEND_LOCAL_TOKEN", "should-not-authorize-lambda")
    with patch("api.dependencies.get_service", return_value=service):
        # Override the original dependency used by both resource-specific apps.
        for handler in [video_handler, backup_handler]:
            handler.app.dependency_overrides[get_service] = lambda: service
        try:
            denied = gateway_event("/videos")
            denied["headers"]["authorization"] = "Bearer should-not-authorize-lambda"
            assert video_handler(denied, None)["statusCode"] == 401
            assert (
                video_handler(gateway_event("/videos", {"sub": "verified"}), None)["statusCode"]
                == 200
            )
            assert (
                backup_handler(gateway_event("/videos", {"sub": "verified"}), None)["statusCode"]
                == 404
            )
            assert (
                video_handler(gateway_event("/videos/x/backup", {"sub": "verified"}), None)[
                    "statusCode"
                ]
                == 404
            )
        finally:
            for handler in [video_handler, backup_handler]:
                handler.app.dependency_overrides.clear()


def test_openapi_generated_from_same_routers():
    saved = json.loads((Path(__file__).parents[2] / "openapi/openapi.json").read_text())
    assert saved == app.openapi()
    assert "/backup_requests" not in saved["paths"]
    assert "post" in saved["paths"]["/videos/{video_id}/backup"]
    assert "202" in saved["paths"]["/videos"]["post"]["responses"]


@pytest.mark.parametrize(
    "routers",
    [
        (video_router, backup_router, comment_router),
        (video_router,),
        (backup_router,),
        (comment_router,),
    ],
)
def test_runtime_apps_have_no_unauthenticated_documentation_routes(routers, monkeypatch):
    monkeypatch.delenv("BACKEND_LOCAL_TOKEN", raising=False)
    with patch("boto3.Session", side_effect=AssertionError("AWS at docs request")):
        runtime = build_app(*routers)
        with TestClient(runtime) as client:
            for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
                assert client.get(path).status_code == 404
        # Disabling automatic HTTP routes must not disable offline schema generation.
        assert runtime.openapi()["paths"]


@pytest.mark.parametrize("handler", [video_handler, backup_handler, comments_handler])
def test_lambda_documentation_routes_are_disabled(handler):
    for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
        with patch("boto3.Session", side_effect=AssertionError("AWS at docs request")):
            assert handler(gateway_event(path), None)["statusCode"] == 404


def test_playlists_are_served_by_the_video_lambda():
    # The video Lambda already holds the YouTube API key; the gateway routes playlists to it.
    assert {"/videos", "/youtube/playlist"} <= video_handler.app.openapi()["paths"].keys()
    assert "/youtube/playlist" not in backup_handler.app.openapi()["paths"]
