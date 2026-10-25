from functools import cache

from repositories.jobs import JobRepository
from repositories.videos import VideoRepository
from usecases.backup import BackupService


@cache
def get_service() -> BackupService:
    # One service per Lambda container: a container handles one invocation at a time, and
    # rebuilding the boto3 session on every request re-loads the service models (slow at 256MB).
    return BackupService(VideoRepository(), JobRepository())
