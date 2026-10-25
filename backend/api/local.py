import os

from api.app import create_app as build_app
from api.dependencies import get_comment_service, get_playlist_service, get_service
from repositories.memory import (
    MemoryCommentBackups,
    MemoryCommentJobs,
    MemoryCommentObjects,
    MemoryJobs,
    MemoryPlaylists,
    MemoryVideos,
    MemoryYoutubeComments,
)
from usecases.backup import BackupService
from usecases.comments import CommentService
from usecases.playlists import PlaylistService
from usecases.youtube_comments import YoutubeCommentStore


def create_app():
    if not os.environ.get("BACKEND_LOCAL_TOKEN"):
        raise RuntimeError("Set BACKEND_LOCAL_TOKEN for the local-only memory server")
    app = build_app()
    service = BackupService(MemoryVideos(), MemoryJobs())
    backups = MemoryCommentBackups()
    stores = {
        "youtube": YoutubeCommentStore(backups, MemoryYoutubeComments(), MemoryCommentObjects())
    }
    comments = CommentService(service.videos, backups, MemoryCommentJobs(), stores)
    service.on_complete = comments.start_after_video_backup
    service.on_delete = comments.delete_for_video
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_comment_service] = lambda: comments
    playlists = PlaylistService(MemoryPlaylists())  # Empty: every playlist is not found.
    app.dependency_overrides[get_playlist_service] = lambda: playlists
    return app
