import os

from api.app import create_app as build_app
from api.dependencies import get_comment_service, get_service
from repositories.memory import (
    MemoryCommentBackups,
    MemoryCommentJobs,
    MemoryJobs,
    MemoryVideos,
    MemoryYoutubeComments,
)
from usecases.backup import BackupService
from usecases.comments import CommentService
from usecases.youtube_comments import YoutubeCommentReader


def create_app():
    if not os.environ.get("BACKEND_LOCAL_TOKEN"):
        raise RuntimeError("Set BACKEND_LOCAL_TOKEN for the local-only memory server")
    app = build_app()
    service = BackupService(MemoryVideos(), MemoryJobs())
    backups = MemoryCommentBackups()
    readers = {"youtube": YoutubeCommentReader(backups, MemoryYoutubeComments())}
    comments = CommentService(service.videos, backups, MemoryCommentJobs(), readers)
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_comment_service] = lambda: comments
    return app
