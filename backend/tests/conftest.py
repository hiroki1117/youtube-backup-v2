import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.dependencies import get_comment_service, get_service
from repositories.memory import MemoryCommentBackups, MemoryCommentJobs, MemoryJobs, MemoryVideos
from usecases.backup import BackupService
from usecases.comments import CommentService


@pytest.fixture
def service():
    return BackupService(MemoryVideos(), MemoryJobs(), clock=lambda: 1791763200)


@pytest.fixture
def comment_service(service):
    return CommentService(
        service.videos, MemoryCommentBackups(), MemoryCommentJobs(), clock=lambda: 1791763200
    )


@pytest.fixture
def client(service, comment_service, monkeypatch):
    monkeypatch.setenv("BACKEND_LOCAL_TOKEN", "test-local-token")
    app = create_app()
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_comment_service] = lambda: comment_service
    with TestClient(app, headers={"Authorization": "Bearer test-local-token"}) as client:
        yield client
