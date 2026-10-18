from repositories.jobs import JobRepository
from repositories.videos import VideoRepository
from usecases.backup import BackupService


def get_service() -> BackupService:
    # Request/invocation scope: mutable boto3 resources are not shared across invocations.
    return BackupService(VideoRepository(), JobRepository())
