from functools import cache

from repositories.comments import (
    CommentBackupRepository,
    CommentJobRepository,
    CommentObjectRepository,
    YoutubeCommentRepository,
)
from repositories.jobs import JobRepository
from repositories.videos import VideoRepository
from usecases.backup import BackupService
from usecases.comments import CommentService
from usecases.youtube_comments import YoutubeCommentIngest, YoutubeCommentStore


@cache
def get_service() -> BackupService:
    # One service per Lambda container: a container handles one invocation at a time, and
    # rebuilding the boto3 session on every request re-loads the service models (slow at 256MB).
    # Completing a video starts its comment backup; deleting it removes its comments.
    comments = get_comment_service()
    return BackupService(
        VideoRepository(),
        JobRepository(),
        on_complete=comments.start_after_video_backup,
        on_delete=comments.delete_for_video,
    )


@cache
def get_comment_service() -> CommentService:
    backups = CommentBackupRepository()
    stores = {
        "youtube": YoutubeCommentStore(
            backups, YoutubeCommentRepository(), CommentObjectRepository()
        )
    }
    return CommentService(VideoRepository(), backups, CommentJobRepository(), stores)


@cache
def get_youtube_comment_ingest() -> YoutubeCommentIngest:
    return YoutubeCommentIngest(
        CommentBackupRepository(), CommentObjectRepository(), YoutubeCommentRepository()
    )
