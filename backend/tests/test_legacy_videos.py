from copy import deepcopy
from unittest.mock import Mock

import pytest

from entrypoints.scrapbox_scan import scan_scrapbox

URL = "https://www.youtube.com/watch?v=abcdefghijk"
NEXT_URL = "https://www.youtube.com/watch?v=lmnopqrstuv"


@pytest.fixture(
    params=[{}, {"request_timestamp": None}, {"request_timestamp": "1640995200"}],
    ids=["missing-time", "unknown-time", "known-time"],
)
def legacy_video(service, request):
    video = service.videos.make_video(URL, 1640995200)
    video.pop("request_timestamp")
    video.update(backupdate="2022-01-01", upload_status="complete", **request.param)
    service.videos.items[video["video_id"]] = deepcopy(video)
    return video


def test_existing_registration_keeps_legacy_data_without_submitting(service, legacy_video):
    result, started = service.register(URL)
    assert not started and result.already_registered
    assert result.video.request_timestamp == legacy_video.get("request_timestamp")
    assert service.videos.get(legacy_video["video_id"]) == legacy_video
    assert service.jobs.submissions == 0


def test_registration_race_reads_legacy_winner(service, legacy_video, monkeypatch):
    original_get = service.videos.get
    first = True

    def get(video_id):
        nonlocal first
        if first:
            first = False
            return None
        return original_get(video_id)

    monkeypatch.setattr(service.videos, "get", get)
    monkeypatch.setattr(service.videos, "insert", Mock(return_value=False))
    result, started = service.register(URL)
    assert not started and result.already_registered
    assert result.video.request_timestamp == legacy_video.get("request_timestamp")
    assert original_get(legacy_video["video_id"]) == legacy_video
    assert service.jobs.submissions == 0


@pytest.mark.parametrize("status", ["complete", "init"])
def test_scrapbox_continues_after_legacy_record(service, legacy_video, status):
    legacy_video["upload_status"] = status
    service.videos.items[legacy_video["video_id"]] = deepcopy(legacy_video)
    source = Mock(video_urls=Mock(return_value=[URL, NEXT_URL]))
    assert scan_scrapbox(service, source) == {"started": 1, "existing": 1}
    assert service.videos.get(legacy_video["video_id"]) == legacy_video
    assert service.video("lmnopqrstuv")["request_timestamp"] == "1791763200"
    assert service.jobs.submissions == 1


def test_video_api_reads_and_updates_legacy_record(client, service, legacy_video):
    expected_time = legacy_video.get("request_timestamp")
    listed = client.get("/videos")
    assert listed.status_code == 200
    assert listed.json()[0]["request_timestamp"] == expected_time
    read = client.get("/videos/abcdefghijk")
    assert read.status_code == 200
    assert read.json()["request_timestamp"] == expected_time
    duplicate = client.post("/videos", json={"url": URL})
    assert duplicate.status_code == 200
    assert duplicate.json()["already_registered"]
    assert duplicate.json()["video"]["request_timestamp"] == expected_time
    edited = client.patch("/videos/abcdefghijk", json={"title": "Edited legacy title"})
    assert edited.status_code == 200
    assert edited.json()["request_timestamp"] == expected_time
    assert service.videos.get(legacy_video["video_id"]) == {
        **legacy_video,
        "title": "Edited legacy title",
    }
    assert service.jobs.submissions == 0


@pytest.mark.parametrize("timestamp", [None, "missing", "invalid"])
def test_unknown_request_time_cannot_complete_from_s3(service, timestamp):
    video = service.videos.make_video(URL, 1640995200)
    if timestamp == "missing":
        video.pop("request_timestamp")
    else:
        video["request_timestamp"] = timestamp
    service.videos.items[video["video_id"]] = deepcopy(video)
    event = {
        "Records": [
            {
                "eventName": "ObjectCreated:Put",
                "eventTime": "2026-10-31T00:00:00Z",
                "s3": {
                    "bucket": {"name": "local-preview"},
                    "object": {"key": "abcdefghijk.mp4"},
                },
            }
        ]
    }
    assert service.complete_records(event) == {"updated": 0, "received": 1}
    assert service.videos.get(video["video_id"]) == video


def test_retry_records_new_attempt_time(service):
    service.register(URL)
    video = service.video("abcdefghijk")
    service.jobs.items[video["batch_job_id"]]["status"] = "FAILED"
    service.clock = lambda: 1791849600
    _, started = service.start("abcdefghijk")
    assert started
    assert service.video("abcdefghijk")["request_timestamp"] == "1791849600"
    assert service.jobs.submissions == 2
