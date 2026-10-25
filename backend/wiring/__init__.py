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
from usecases.youtube_comments import YoutubeCommentIngest


@cache
def get_service() -> BackupService:
    # One service per Lambda container: a container handles one invocation at a time, and
    # rebuilding the boto3 session on every request re-loads the service models (slow at 256MB).
    return BackupService(VideoRepository(), JobRepository())


@cache
def get_comment_service() -> CommentService:
    return CommentService(VideoRepository(), CommentBackupRepository(), CommentJobRepository())


@cache
def get_youtube_comment_ingest() -> YoutubeCommentIngest:
    return YoutubeCommentIngest(
        CommentBackupRepository(), CommentObjectRepository(), YoutubeCommentRepository()
    )
