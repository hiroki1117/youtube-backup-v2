import os
from datetime import UTC, datetime
from functools import cached_property
from urllib.parse import urlparse

import boto3
import httpx
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from usecases.models import TIKTOK_HOSTS, DomainError, is_tiktok_short_link, source_identity


def conditional(error: ClientError) -> None:
    if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
        raise DomainError(409, "concurrent_change") from None
    raise error


class VideoRepository:
    """Owns the existing DynamoDB video item, S3 file, and source metadata lookup."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    # Clients are created on first use so a request only pays for the AWS services it touches
    # (e.g. listing videos needs DynamoDB only).
    @cached_property
    def table(self):
        return self.session.resource("dynamodb").Table(os.environ["DYNAMO_TABLE_NAME"])

    @cached_property
    def s3(self):
        return self.session.client("s3")

    @cached_property
    def ssm(self):
        return self.session.client("ssm")

    def get(self, video_id: str) -> dict | None:
        return self.table.get_item(Key={"video_id": video_id}, ConsistentRead=True).get("Item")

    def list(self, status: str, limit: int) -> list[dict]:
        return self.table.query(
            IndexName="upload_status-backupdate-index",
            KeyConditionExpression=Key("upload_status").eq(status),
            Limit=limit,
            ScanIndexForward=False,
        )["Items"]

    def iterate(self, status: str):
        # Every video in the status, newest first, across Query pages (id and platform only).
        start = {}
        while True:
            page = self.table.query(
                IndexName="upload_status-backupdate-index",
                KeyConditionExpression=Key("upload_status").eq(status),
                ProjectionExpression="video_id, platform",
                ScanIndexForward=False,
                **start,
            )
            yield from page["Items"]
            if "LastEvaluatedKey" not in page:
                return
            start = {"ExclusiveStartKey": page["LastEvaluatedKey"]}

    def resolve(self, url: str) -> str:
        """The video URL behind a TikTok share link; any other URL as is."""
        if not is_tiktok_short_link(url):
            return url
        try:
            with httpx.Client(timeout=15) as client:
                response = client.get(url)
        except httpx.HTTPError:
            raise DomainError(502, "tiktok_link_unavailable") from None
        location = response.headers.get("location", "") if response.is_redirect else ""
        if (urlparse(location).hostname or "").lower() not in TIKTOK_HOSTS:
            raise DomainError(502, "tiktok_link_unavailable")
        # An unknown share code redirects to the home page, rejected as invalid_tiktok_url.
        return location

    def make_video(self, url: str, now: int) -> dict:
        video_id, platform, normalized = source_identity(url)
        title = video_id
        if platform == "youtube":
            key = self.ssm.get_parameter(
                Name=os.environ["SSM_YOUTUBE_API_KEY_PARAMETER"], WithDecryption=True
            )["Parameter"]["Value"]
            try:
                with httpx.Client(timeout=15) as client:
                    response = client.get(
                        "https://www.googleapis.com/youtube/v3/videos",
                        params={"id": video_id, "key": key, "part": "snippet"},
                    )
                    response.raise_for_status()
                    title = response.json()["items"][0]["snippet"]["title"]
            except httpx.HTTPError, ValueError, KeyError, IndexError:
                raise DomainError(502, "metadata_unavailable") from None
        elif platform == "tiktok":
            # TikTok's oEmbed no longer returns the caption; name it by the poster until edited.
            title = urlparse(normalized).path.split("/")[1] + " の TikTok"
        date = datetime.fromtimestamp(now, UTC).date()
        filename = "ABCXYZ" + video_id if video_id.startswith("-") else video_id
        return {
            "video_id": video_id,
            "video_url": normalized,
            "platform": platform,
            "title": title,
            "backupdate": str(date),
            "upload_status": "init",
            "request_timestamp": str(now),
            "s3fullpath": f"s3://{os.environ['BACKUP_BACKET']}/{platform}/"
            f"{date.year}/{date.month}/{date.day}/{filename}",
        }

    def insert(self, video: dict) -> bool:
        try:
            self.table.put_item(Item=video, ConditionExpression="attribute_not_exists(video_id)")
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def update_title(self, video_id: str, title: str) -> dict:
        try:
            return self.table.update_item(
                Key={"video_id": video_id},
                UpdateExpression="SET title = :title",
                ExpressionAttributeValues={":title": title},
                ConditionExpression="attribute_exists(video_id)",
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise DomainError(404, "video_not_found") from None
            raise

    def claim(self, video: dict, attempt: str, path: str, now: int) -> dict:
        expected = video.get("backup_attempt_id")
        condition = (
            "attribute_exists(video_id) AND attribute_not_exists(deletion_token) "
            "AND upload_status=:init"
        )
        values = {
            ":attempt": attempt,
            ":path": path,
            ":now": str(now),
            ":state": "submitting",
            ":init": "init",
        }
        if expected:
            condition += " AND backup_attempt_id = :expected"
            values[":expected"] = expected
        else:
            condition += " AND attribute_not_exists(backup_attempt_id)"
        try:
            return self.table.update_item(
                Key={"video_id": video["video_id"]},
                UpdateExpression="SET backup_attempt_id=:attempt, s3fullpath=:path, "
                "request_timestamp=:now, backup_state=:state, upload_status=:init "
                "REMOVE batch_job_id",
                ConditionExpression=condition,
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as error:
            conditional(error)

    def attach_job(self, video_id: str, attempt: str, job_id: str) -> None:
        self._attempt_update(video_id, attempt, "SET batch_job_id=:job", {":job": job_id})

    def unknown_submission(self, video_id: str, attempt: str) -> None:
        self._attempt_update(
            video_id,
            attempt,
            "SET backup_state=:state",
            {":state": "submission_unknown"},
            require_pending=True,
        )

    def _attempt_update(
        self,
        video_id: str,
        attempt: str,
        expression: str,
        values: dict,
        *,
        require_pending: bool = False,
    ) -> None:
        condition = "attribute_exists(video_id) AND backup_attempt_id=:attempt"
        if require_pending:
            condition += " AND upload_status=:init"
            values = {**values, ":init": "init"}
        try:
            self.table.update_item(
                Key={"video_id": video_id},
                UpdateExpression=expression,
                ConditionExpression=condition,
                ExpressionAttributeValues={**values, ":attempt": attempt},
            )
        except ClientError as error:
            conditional(error)

    def complete(self, video: dict, actual_path: str) -> bool:
        try:
            self.table.update_item(
                Key={"video_id": video["video_id"]},
                UpdateExpression=(
                    "SET upload_status=:complete, s3fullpath=:actual, backup_state=:done"
                ),
                ConditionExpression="attribute_exists(video_id) AND upload_status=:init "
                "AND s3fullpath=:expected AND attribute_not_exists(deletion_token)",
                ExpressionAttributeValues={
                    ":complete": "complete",
                    ":actual": actual_path,
                    ":done": "complete",
                    ":init": "init",
                    ":expected": video["s3fullpath"],
                },
            )
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def playback_url(self, video: dict) -> str:
        path = urlparse(video["s3fullpath"])
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": path.netloc, "Key": path.path.lstrip("/")},
            ExpiresIn=3600,
        )

    def has_object(self, video: dict) -> bool:
        # yt-dlp appends the real extension, so look for anything under the expected key.
        path = urlparse(video["s3fullpath"])
        found = self.s3.list_objects_v2(Bucket=path.netloc, Prefix=path.path.lstrip("/"), MaxKeys=1)
        return found.get("KeyCount", 0) > 0

    def cancel(self, video: dict) -> None:
        # Only the attempt that was inspected may be removed; a retry claim changes s3fullpath.
        try:
            self.table.delete_item(
                Key={"video_id": video["video_id"]},
                ConditionExpression="attribute_exists(video_id) AND upload_status=:init "
                "AND s3fullpath=:path AND attribute_not_exists(deletion_token)",
                ExpressionAttributeValues={":init": "init", ":path": video["s3fullpath"]},
            )
        except ClientError as error:
            conditional(error)

    def delete(self, video: dict, token: str, before_remove=None) -> None:
        # Lock against concurrent backup submission before deleting either resource.
        # before_remove(video) deletes data tied to the video (comments) while the lock is held.
        condition = "attribute_exists(video_id) AND attribute_not_exists(deletion_token) "
        condition += "AND s3fullpath=:path AND upload_status=:complete"
        try:
            self.table.update_item(
                Key={"video_id": video["video_id"]},
                UpdateExpression="SET deletion_token=:token",
                ConditionExpression=condition,
                ExpressionAttributeValues={
                    ":token": token,
                    ":path": video["s3fullpath"],
                    ":complete": "complete",
                },
            )
            if before_remove:
                before_remove(video)
            path = urlparse(video["s3fullpath"])
            self.s3.delete_object(Bucket=path.netloc, Key=path.path.lstrip("/"))
            self.table.delete_item(
                Key={"video_id": video["video_id"]},
                ConditionExpression="deletion_token=:token",
                ExpressionAttributeValues={":token": token},
            )
        except ClientError as error:
            # Preserve lock on partial deletion; operator reconciliation is required.
            conditional(error)
