import os
from functools import cached_property
from urllib.parse import urlparse

import boto3
from botocore.config import Config


class JobRepository:
    """Batch registration/query and its SSM inputs. No AWS work until constructed/called."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def batch(self):
        # SubmitJob has no idempotency token: never automatically resend an ambiguous request.
        return self.session.client("batch", config=Config(retries={"total_max_attempts": 1}))

    @cached_property
    def ssm(self):
        return self.session.client("ssm")

    def submit(self, video: dict, attempt_id: str) -> str:
        path = urlparse(video["s3fullpath"])
        values = self.ssm.get_parameters(
            Names=[
                os.environ["SSM_PROXY_PATH_PARAMETER"],
                os.environ["SSM_COOKIE_S3_PATH_PARAMETER"],
            ],
            WithDecryption=True,
        )
        params = {p["Name"]: p["Value"] for p in values["Parameters"]}
        env = {
            "URL": video["video_url"],
            "FILENAME": path.path.rsplit("/", 1)[-1],
            "S3PATH": f"s3://{path.netloc}{path.path.rsplit('/', 1)[0]}/",
            "PROXY_PATH": params.get(os.environ["SSM_PROXY_PATH_PARAMETER"], ""),
            "COOKIE_S3_PATH": params.get(os.environ["SSM_COOKIE_S3_PATH_PARAMETER"], ""),
        }
        result = self.batch.submit_job(
            jobName=f"youtube-backup-{attempt_id}",
            jobQueue=os.environ["JOB_QUEUE_NAME"],
            jobDefinition=(
                os.environ["YTDLP_JOB_DEFINITION_NAME"] + ":" + os.environ["YTDLP_JOB_REVISION"]
            ),
            containerOverrides={"environment": [{"name": k, "value": v} for k, v in env.items()]},
        )
        return result["jobId"]

    def get(self, job_id: str) -> dict | None:
        jobs = self.batch.describe_jobs(jobs=[job_id])["jobs"]
        return jobs[0] if jobs else None
