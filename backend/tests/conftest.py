import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import (
    get_comment_service,
    get_playlist_service,
    get_search_service,
    get_service,
)
from repositories.memory import (
    MemoryCommentBackups,
    MemoryCommentJobs,
    MemoryCommentObjects,
    MemoryJobs,
    MemoryPlaylists,
    MemorySearchIndex,
    MemoryVideos,
    MemoryYoutubeComments,
)
from usecases.backup import BackupService
from usecases.comments import CommentService
from usecases.playlists import PlaylistService
from usecases.search import SearchService
from usecases.youtube_comments import YoutubeCommentStore


@pytest.fixture
def service():
    return BackupService(MemoryVideos(), MemoryJobs(), clock=lambda: 1791763200)


@pytest.fixture
def comment_service(service):
    """Comment service wired into `service` like the Lambdas: completion and deletion hooks."""
    backups = MemoryCommentBackups()
    stores = {
        "youtube": YoutubeCommentStore(backups, MemoryYoutubeComments(), MemoryCommentObjects())
    }
    comments = CommentService(
        service.videos, backups, MemoryCommentJobs(), stores, clock=lambda: 1791763200
    )
    service.on_complete = comments.start_after_video_backup
    service.on_delete = comments.delete_for_video
    return comments


@pytest.fixture
def playlists():
    return MemoryPlaylists()


@pytest.fixture
def search_service(service):
    return SearchService(MemorySearchIndex(), service.videos)


@pytest.fixture
def client(service, comment_service, playlists, search_service, monkeypatch):
    monkeypatch.setenv("BACKEND_LOCAL_TOKEN", "test-local-token")
    app = create_app()
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_comment_service] = lambda: comment_service
    app.dependency_overrides[get_playlist_service] = lambda: PlaylistService(playlists)
    app.dependency_overrides[get_search_service] = lambda: search_service
    with TestClient(app, headers={"Authorization": "Bearer test-local-token"}) as client:
        yield client
