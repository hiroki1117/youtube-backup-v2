import os
from functools import cached_property

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from usecases.models import DomainError


def condition_failed(error: ClientError) -> bool:
    return error.response["Error"]["Code"] == "ConditionalCheckFailedException"


def conditional(error: ClientError) -> None:
    if condition_failed(error):
        raise DomainError(409, "concurrent_change") from None
    raise error


class AwsRepository:
    """Clients are created on first use, so a request pays only for the services it touches."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def ssm(self):
        return self.session.client("ssm")

    def secret(self, variable: str) -> str:
        """The value of the SSM parameter named by an environment variable."""
        name = os.environ[variable]
        return self.ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]


class BatchRepository(AwsRepository):
    @cached_property
    def batch(self):
        # SubmitJob has no idempotency token: never automatically resend an ambiguous request.
        return self.session.client("batch", config=Config(retries={"total_max_attempts": 1}))

    def get(self, job_id: str) -> dict | None:
        jobs = self.batch.describe_jobs(jobs=[job_id])["jobs"]
        return jobs[0] if jobs else None

    def terminate(self, job_id: str, reason: str) -> None:
        # Works in any non-terminal state: queued jobs are cancelled, running ones stopped.
        self.batch.terminate_job(jobId=job_id, reason=reason)
