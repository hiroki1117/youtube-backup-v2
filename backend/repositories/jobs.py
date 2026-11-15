import os
from urllib.parse import urlparse

from repositories.aws import BatchRepository


class JobRepository(BatchRepository):
    """Submits the video backup job with its SSM inputs."""

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
