import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import get_comment_service, get_service
from repositories.memory import (
    MemoryCommentBackups,
    MemoryCommentJobs,
    MemoryCommentObjects,
    MemoryJobs,
    MemoryVideos,
    MemoryYoutubeComments,
)
from usecases.backup import BackupService
from usecases.comments import CommentService
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
def client(service, comment_service, monkeypatch):
    monkeypatch.setenv("BACKEND_LOCAL_TOKEN", "test-local-token")
    app = create_app()
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_comment_service] = lambda: comment_service
    with TestClient(app, headers={"Authorization": "Bearer test-local-token"}) as client:
        yield client
