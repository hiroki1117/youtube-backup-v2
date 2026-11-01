"""SQL of SearchRepository against a real Postgres. CI applies db/migrations and sets the URL."""

import os

import psycopg
import pytest
from psycopg import errors

from repositories.search import SearchRepository

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL is not set")


def video(video_id, title, backupdate="2026-10-12", **extra):
    return {
        "video_id": video_id,
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "platform": "youtube",
        "title": title,
        "backupdate": backupdate,
        "s3fullpath": f"s3://bucket/{video_id}",
        "upload_status": "complete",
        "request_timestamp": None,
        **extra,
    }


@pytest.fixture
def repository():
    with psycopg.connect(URL, autocommit=True) as connection:
        connection.execute("TRUNCATE videos")
    return SearchRepository(session=object(), url=URL)


def test_replace_all_inserts_updates_and_deletes(repository):
    repository.replace_all([video("same", "同じ"), video("edit", "前"), video("gone", "消える")])

    assert repository.replace_all([video("same", "同じ"), video("edit", "後")]) == 2

    assert [v["video_id"] for v in repository.search(["同じ"], None, None, 10)] == ["same"]
    assert [v["title"] for v in repository.search(["後"], None, None, 10)] == ["後"]
    assert repository.search(["前"], None, None, 10) == []
    assert repository.search(["消える"], None, None, 10) == []


def test_search_matches_partially_ignoring_case_and_returns_a_full_video(repository):
    stored = video("v1", "Neon で検索を作る", request_timestamp="1791763200")
    repository.replace_all([stored])

    assert repository.search(["neon", "検索"], None, None, 10) == [stored]


def test_search_short_terms_and_literal_wildcards(repository):
    repository.replace_all([video("a", "猫"), video("b", "100%_割引"), video("c", "1000")])

    assert [v["video_id"] for v in repository.search(["猫"], None, None, 10)] == ["a"]
    assert [v["video_id"] for v in repository.search(["0%_"], None, None, 10)] == ["b"]


def test_search_orders_newest_first_and_limits(repository):
    repository.replace_all(
        [
            video("old", "猫", "2026-01-01"),
            video("new", "猫", "2026-03-01"),
            video("mid", "猫", "2026-02-01"),
        ]
    )

    assert [v["video_id"] for v in repository.search(["猫"], None, None, 2)] == ["new", "mid"]


def test_search_matches_part_of_the_video_id(repository):
    repository.replace_all([video("dQw4w9WgXcQ", "猫"), video("other", "犬")])

    found = repository.search(["w4W9"], None, None, 10)

    assert [v["video_id"] for v in found] == ["dQw4w9WgXcQ"]


def test_search_bounds_backup_dates_inclusively_without_terms(repository):
    repository.replace_all(
        [
            video("before", "猫", "2026-01-31"),
            video("first", "猫", "2026-02-01"),
            video("last", "猫", "2026-02-28"),
            video("after", "猫", "2026-03-01"),
        ]
    )

    found = repository.search([], "2026-02-01", "2026-02-28", 10)

    assert [v["video_id"] for v in found] == ["last", "first"]


def test_roles_have_only_their_own_privileges(repository):
    repository.replace_all([video("v1", "猫")])
    with psycopg.connect(URL, autocommit=True) as connection:
        connection.execute("SET ROLE search_writer")
        connection.execute("UPDATE videos SET title = '犬'")
        connection.execute("RESET ROLE")
        connection.execute("SET ROLE search_reader")
        assert connection.execute("SELECT count(*) FROM videos").fetchone() == (1,)
        with pytest.raises(errors.InsufficientPrivilege):
            connection.execute("DELETE FROM videos")
