from unittest.mock import Mock

import httpx
import pytest

from repositories.playlists import PlaylistRepository
from usecases.models import DomainError, playlist_identity

PLAYLIST = "PLabcdefghijklmnopqrstuvwxyz012345"
VIDEO = {"video_id": "abcdefghijk", "url": "https://www.youtube.com/watch?v=abcdefghijk"}


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/playlist?list={PLAYLIST}",
        f"https://www.youtube.com/watch?v=abcdefghijk&list={PLAYLIST}&index=3",
        f"https://youtu.be/abcdefghijk?list={PLAYLIST}",
        f"https://m.youtube.com/playlist?list={PLAYLIST}",
        f"https://music.youtube.com/playlist?list={PLAYLIST}",
    ],
)
def test_playlist_id_from_every_youtube_url_form(url):
    assert playlist_identity(url) == PLAYLIST


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("https://www.youtube.com/watch?v=abcdefghijk", "not_a_youtube_playlist"),
        (f"https://example.invalid/playlist?list={PLAYLIST}", "not_a_youtube_playlist"),
        ("https://www.youtube.com/playlist?list=PL%2Fx", "not_a_youtube_playlist"),
        (f"ftp://www.youtube.com/playlist?list={PLAYLIST}", "invalid_url"),
        ("https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk", "unsupported_playlist"),
        ("https://www.youtube.com/playlist?list=WL", "unsupported_playlist"),
        ("https://www.youtube.com/playlist?list=LL", "unsupported_playlist"),
    ],
)
def test_non_playlists_and_playlists_an_api_key_cannot_read(url, code):
    with pytest.raises(DomainError, match=code) as error:
        playlist_identity(url)
    assert error.value.status == 422


def test_api_lists_videos_without_registering(client, playlists, service):
    playlists.items[PLAYLIST] = ([VIDEO | {"title": "Example video"}], 2)
    url = f"https://www.youtube.com/playlist?list={PLAYLIST}"
    response = client.get("/youtube/playlist", params={"url": url})
    assert response.status_code == 200
    assert response.json() == {
        "playlist_id": PLAYLIST,
        "videos": [VIDEO | {"title": "Example video"}],
        "unavailable_count": 2,
    }
    assert service.videos.items == {}
    missing = f"https://www.youtube.com/playlist?list=PL{'x' * 32}"
    response = client.get("/youtube/playlist", params={"url": missing})
    assert response.status_code == 404
    assert response.json() == {"detail": "playlist_not_found"}
    response = client.get("/youtube/playlist", params={"url": "https://youtu.be/abcdefghijk"})
    assert response.status_code == 422
    assert response.json() == {"detail": "not_a_youtube_playlist"}
    assert client.get("/youtube/playlist").status_code == 422


def item(video_id, title, privacy="public"):
    return {
        "snippet": {"title": title, "resourceId": {"kind": "youtube#video", "videoId": video_id}},
        "status": {"privacyStatus": privacy},
    }


def make_repo(monkeypatch, handler):
    monkeypatch.setenv("SSM_YOUTUBE_API_KEY_PARAMETER", "/example/youtube-key")
    repo = PlaylistRepository(session=Mock())
    repo.ssm = Mock()
    repo.ssm.get_parameter.return_value = {"Parameter": {"Value": "dummy-key"}}
    real_client = httpx.Client
    monkeypatch.setattr(
        "repositories.playlists.httpx.Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    return repo


def test_pages_through_the_playlist_and_skips_unavailable_and_repeated(monkeypatch):
    seen = []
    pages = {
        None: {
            "items": [
                item("abcdefghijk", "First"),
                item("deletedvid1", "Deleted video", "privacyStatusUnspecified"),
                {"snippet": {"title": "Deleted video"}, "status": {}},
            ],
            "nextPageToken": "page-2",
        },
        "page-2": {
            "items": [
                item("bcdefghijkl", "Second", "unlisted"),
                item("privatevid1", "Private video", "private"),
                item("abcdefghijk", "First again"),
            ]
        },
    }

    def handler(request):
        seen.append(request.url.params)
        return httpx.Response(200, json=pages[request.url.params.get("pageToken")])

    repo = make_repo(monkeypatch, handler)
    videos, unavailable = repo.videos(PLAYLIST)
    assert [(v["video_id"], v["title"]) for v in videos] == [
        ("abcdefghijk", "First"),
        ("bcdefghijkl", "Second"),
    ]
    assert videos[0]["url"] == "https://www.youtube.com/watch?v=abcdefghijk"
    assert unavailable == 3
    assert len(seen) == 2
    # 50 is the most per page (1 quota unit each); the default would be 5.
    assert all(p["maxResults"] == "50" and p["playlistId"] == PLAYLIST for p in seen)


@pytest.mark.parametrize(
    ("status", "reason"), [(404, "playlistNotFound"), (403, "playlistItemsNotAccessible")]
)
def test_missing_or_private_playlist_is_not_found(monkeypatch, status, reason):
    body = {"error": {"errors": [{"reason": reason}]}}
    repo = make_repo(monkeypatch, lambda request: httpx.Response(status, json=body))
    with pytest.raises(DomainError, match="playlist_not_found") as error:
        repo.videos(PLAYLIST)
    assert error.value.status == 404


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(403, json={"error": {"errors": [{"reason": "quotaExceeded"}]}}),
        httpx.Response(500, text="oops"),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"items": [{"status": {"privacyStatus": "public"}}]}),
    ],
)
def test_other_failures_are_sanitized(monkeypatch, response):
    repo = make_repo(monkeypatch, lambda request: response)
    with pytest.raises(DomainError, match="playlist_unavailable") as error:
        repo.videos(PLAYLIST)
    assert error.value.status == 502
    assert "dummy-key" not in str(error.value)
