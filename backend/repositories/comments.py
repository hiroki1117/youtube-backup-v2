import gzip
import json
import os
from functools import cached_property

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

from repositories.videos import conditional


class CommentBackupRepository:
    """Owns comment_backups: one request-tracking item per video, shared by all platforms."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def dynamodb(self):
        return self.session.resource("dynamodb")

    @cached_property
    def table(self):
        return self.dynamodb.Table(os.environ["COMMENT_BACKUPS_TABLE_NAME"])

    def get(self, video_id: str) -> dict | None:
        return self.table.get_item(Key={"video_id": video_id}, ConsistentRead=True).get("Item")

    def tracked(self, video_ids: list[str]) -> set[str]:
        """The given videos (at most 100) that already have a comment backup record."""
        found, keys = set(), [{"video_id": video_id} for video_id in video_ids]
        while keys:
            name = self.table.name
            result = self.dynamodb.batch_get_item(
                RequestItems={name: {"Keys": keys, "ProjectionExpression": "video_id"}}
            )
            found.update(item["video_id"] for item in result["Responses"].get(name, []))
            keys = result.get("UnprocessedKeys", {}).get(name, {}).get("Keys", [])
        return found

    def claim(self, video_id: str, platform: str, attempt: str, now: int, expected) -> dict:
        # Optimistic lock on the attempt that was inspected: concurrent starts cannot both claim.
        if expected:
            condition, values = "attempt_id = :expected", {":expected": expected}
        else:
            condition, values = "attribute_not_exists(video_id)", {}
        try:
            return self.table.update_item(
                Key={"video_id": video_id},
                UpdateExpression="SET platform=:platform, attempt_id=:attempt, #state=:submitting, "
                "requested_at=:now REMOVE batch_job_id",
                ConditionExpression=condition,
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    **values,
                    ":platform": platform,
                    ":attempt": attempt,
                    ":submitting": "submitting",
                    ":now": now,
                },
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as error:
            conditional(error)

    def delete(self, video_id: str) -> None:
        self.table.delete_item(Key={"video_id": video_id})

    def attach_job(self, video_id: str, attempt: str, job_id: str) -> None:
        try:
            self.table.update_item(
                Key={"video_id": video_id},
                UpdateExpression="SET batch_job_id=:job, #state=:running",
                ConditionExpression="attempt_id = :attempt",
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    ":job": job_id,
                    ":running": "running",
                    ":attempt": attempt,
                },
            )
        except ClientError as error:
            conditional(error)

    def complete(self, video_id: str, attempt: str, count: int, now: int) -> bool:
        try:
            self.table.update_item(
                Key={"video_id": video_id},
                UpdateExpression="SET #state=:complete, comment_count=:count, completed_at=:now, "
                "completed_attempt=:attempt",
                ConditionExpression="attempt_id = :attempt",
                ExpressionAttributeNames={"#state": "state"},
                ExpressionAttributeValues={
                    ":complete": "complete",
                    ":count": count,
                    ":now": now,
                    ":attempt": attempt,
                },
            )
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise


class CommentJobRepository:
    """Submits each platform's comment job (its own Batch job definition) to the comment queue."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def batch(self):
        # SubmitJob has no idempotency token: never automatically resend an ambiguous request.
        return self.session.client("batch", config=Config(retries={"total_max_attempts": 1}))

    @cached_property
    def ssm(self):
        return self.session.client("ssm")

    def submit(self, platform: str, url: str, attempt: str, key: str) -> str:
        cookie = self.ssm.get_parameter(
            Name=os.environ["SSM_COOKIE_S3_PATH_PARAMETER"], WithDecryption=True
        )["Parameter"]["Value"]
        prefix = platform.upper()
        env = {
            "URL": url,
            "S3PATH": f"s3://{os.environ['COMMENTS_BUCKET']}/{key}",
            "COOKIE_S3_PATH": cookie,
        }
        result = self.batch.submit_job(
            jobName=f"{platform}-comments-{attempt}",
            jobQueue=os.environ["COMMENTS_JOB_QUEUE_NAME"],
            jobDefinition=os.environ[f"{prefix}_COMMENTS_JOB_DEFINITION_NAME"]
            + ":"
            + os.environ[f"{prefix}_COMMENTS_JOB_REVISION"],
            containerOverrides={"environment": [{"name": k, "value": v} for k, v in env.items()]},
        )
        return result["jobId"]

    def get(self, job_id: str) -> dict | None:
        jobs = self.batch.describe_jobs(jobs=[job_id])["jobs"]
        return jobs[0] if jobs else None

    def terminate(self, job_id: str, reason: str) -> None:
        self.batch.terminate_job(jobId=job_id, reason=reason)


class CommentObjectRepository:
    """Reads the gzip JSON that a comment job stored in the comments bucket, and removes it."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def s3(self):
        return self.session.client("s3")

    def read_json(self, bucket: str, key: str) -> dict:
        body = self.s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        return json.loads(gzip.decompress(body))

    def delete_prefix(self, prefix: str) -> None:
        # The bucket is versioned: this adds delete markers and keeps older versions, like the
        # video bucket's deletion.
        bucket = os.environ["COMMENTS_BUCKET"]
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if not keys:
                continue
            result = self.s3.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            if result.get("Errors"):
                raise RuntimeError(f"failed to delete {len(result['Errors'])} comment objects")


class YoutubeCommentRepository:
    """Owns youtube_comments: one item per comment (video_id, comment_id)."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def table(self):
        return self.session.resource("dynamodb").Table(os.environ["YOUTUBE_COMMENTS_TABLE_NAME"])

    def list(self, video_id: str, **query) -> list[dict]:
        # Every comment of the video (bounded by the job's comment limit), across Query pages.
        items, start = [], {}
        while True:
            page = self.table.query(
                KeyConditionExpression=Key("video_id").eq(video_id), **query, **start
            )
            items.extend(page["Items"])
            if "LastEvaluatedKey" not in page:
                return items
            start = {"ExclusiveStartKey": page["LastEvaluatedKey"]}

    def delete(self, video_id: str) -> None:
        keys = self.list(video_id, ProjectionExpression="video_id, comment_id")
        with self.table.batch_writer() as writer:
            for key in keys:
                writer.delete_item(
                    Key={"video_id": key["video_id"], "comment_id": key["comment_id"]}
                )

    def put(self, items: list[dict]) -> None:
        # batch_writer sends 25 per request and resends unprocessed items; puts are idempotent.
        with self.table.batch_writer(overwrite_by_pkeys=["video_id", "comment_id"]) as writer:
            for item in items:
                writer.put_item(Item=item)
