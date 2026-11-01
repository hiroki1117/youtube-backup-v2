import pytest

from repositories.memory import MemorySearchIndex, MemoryVideos
from repositories.search import like_pattern
from usecases.search import SearchService


def video(video_id, title, backupdate="2026-10-12", **extra):
    return {
        "video_id": video_id,
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "platform": "youtube",
        "title": title,
        "backupdate": backupdate,
        "s3fullpath": f"s3://bucket/{video_id}",
        "upload_status": "complete",
        **extra,
    }


def test_search_returns_videos_containing_every_term_newest_first(client, search_service):
    search_service.index.replace_all(
        [
            video("old", "猫の動画 まとめ", "2026-01-01"),
            video("new", "まとめ 猫", "2026-02-01"),
            video("dog", "犬の動画"),
        ]
    )

    response = client.get("/search/videos", params={"q": "まとめ　猫", "limit": 10})

    assert response.status_code == 200
    assert [v["video_id"] for v in response.json()] == ["new", "old"]


def test_search_limits_the_results(client, search_service):
    search_service.index.replace_all([video(f"v{n}", "猫") for n in range(3)])

    assert len(client.get("/search/videos", params={"q": "猫", "limit": 2}).json()) == 2


def test_blank_query_finds_nothing_without_reading_the_index(client, search_service):
    search_service.index = None

    assert client.get("/search/videos", params={"q": "   "}).json() == []
    assert client.get("/search/videos").json() == []


def test_search_matches_part_of_the_video_id(client, search_service):
    search_service.index.replace_all([video("dQw4w9WgXcQ", "猫"), video("other", "犬")])

    found = client.get("/search/videos", params={"q": "w4w9"}).json()

    assert [v["video_id"] for v in found] == ["dQw4w9WgXcQ"]


def test_search_filters_by_inclusive_backup_dates_without_a_query(client, search_service):
    search_service.index.replace_all(
        [
            video("before", "猫", "2026-01-31"),
            video("first", "猫", "2026-02-01"),
            video("last", "犬", "2026-02-28"),
            video("after", "猫", "2026-03-01"),
        ]
    )
    dates = {"backup_from": "2026-02-01", "backup_to": "2026-02-28"}

    found = client.get("/search/videos", params=dates).json()
    assert [v["video_id"] for v in found] == ["last", "first"]

    found = client.get("/search/videos", params={**dates, "q": "猫"}).json()
    assert [v["video_id"] for v in found] == ["first"]


@pytest.mark.parametrize(
    "params",
    [
        {"q": "x" * 201},
        {"q": "a\x00b"},
        {"q": "x", "limit": 101},
        {"backup_from": "2026-13-01"},
        {"backup_to": "yesterday"},
    ],
)
def test_invalid_search_is_rejected(client, params):
    assert client.get("/search/videos", params=params).status_code == 422


def test_sync_replaces_the_copy_and_skips_videos_being_deleted():
    videos = MemoryVideos()
    videos.items = {
        "kept": video("kept", "kept"),
        "deleting": video("deleting", "deleting", deletion_token="token"),
    }
    index = MemorySearchIndex()
    index.replace_all([video("gone", "gone")])

    assert SearchService(index, videos).sync() == {"synced": 1, "skipped": 0}
    assert list(index.items) == ["kept"]


def test_sync_skips_old_items_without_the_attributes_a_video_needs():
    videos = MemoryVideos()
    videos.items = {
        "kept": video("kept", "kept"),
        "no_title": {**video("no_title", "x"), "title": None},
        "bare": {"video_id": "bare", "upload_status": "complete"},
    }
    index = MemorySearchIndex()

    assert SearchService(index, videos).sync() == {"synced": 1, "skipped": 2}
    assert list(index.items) == ["kept"]


def test_sync_refuses_to_empty_the_copy_when_no_video_is_read():
    index = MemorySearchIndex()
    index.replace_all([video("kept", "kept")])

    with pytest.raises(RuntimeError):
        SearchService(index, MemoryVideos()).sync()

    assert list(index.items) == ["kept"]


def test_like_pattern_escapes_wildcards():
    assert like_pattern(r"100%_a\b") == r"%100\%\_a\\b%"
