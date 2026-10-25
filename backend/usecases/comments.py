import logging
import time
from itertools import batched
from uuid import uuid4

from usecases.backup import ACTIVE
from usecases.models import CommentBackup, DomainError

logger = logging.getLogger(__name__)

# Platforms whose comments can be backed up. Comment formats differ per platform, so each one has
# its own Batch image, S3 prefix, ingest Lambda and comment table. This service only tracks the
# request (comment_backups); reading and deleting comments is delegated to each platform's store.
PLATFORMS = {"youtube"}
# A claim whose job was never attached (the Lambda died mid-submission) stops blocking after this.
SUBMISSION_TIMEOUT = 300


def comments_key(platform: str, video_id: str, attempt: str) -> str:
    # Attempt-specific keys keep every fetch and let ingestion ignore replaced attempts.
    return f"{platform}/{video_id}/{attempt}.json.gz"


class CommentService:
    def __init__(self, videos, backups, jobs, stores=None, clock=time.time):
        self.videos = videos
        self.backups = backups
        self.jobs = jobs
        # platform -> that platform's comment store (its own table, objects and response shape).
        self.stores = stores or {}
        self.clock = clock

    def video(self, video_id: str) -> dict:
        video = self.videos.get(video_id)
        if video is None:
            raise DomainError(404, "video_not_found")
        if video.get("deletion_token"):
            raise DomainError(409, "deletion_needs_reconciliation")
        return video

    def status(self, video_id: str) -> CommentBackup:
        video = self.video(video_id)
        backup = self.backups.get(video_id)
        if backup is None or backup["platform"] != video["platform"]:
            return CommentBackup(video_id=video_id, platform=video["platform"], state="not_started")
        return self._view(backup, self._state(backup))

    def start(self, video_id: str) -> tuple[CommentBackup, bool]:
        video = self.video(video_id)
        if video["upload_status"] != "complete":
            raise DomainError(409, "backup_not_complete")
        platform = video["platform"]
        if platform not in PLATFORMS:
            raise DomainError(422, "comments_not_supported")
        current = self.backups.get(video_id)
        if current and current["platform"] == platform:
            state = self._state(current)
            if state in ("submitting", "running"):
                return self._view(current, state), False
        # Unlike a video backup, a duplicate comment job is harmless: ingestion applies only the
        # current attempt, so a failed, stale or unknown attempt is simply replaced.
        attempt = uuid4().hex
        now = int(self.clock())
        claimed = self.backups.claim(
            video_id, platform, attempt, now, expected=current["attempt_id"] if current else None
        )
        try:
            job_id = self.jobs.submit(
                platform, video["video_url"], attempt, comments_key(platform, video_id, attempt)
            )
            self.backups.attach_job(video_id, attempt, job_id)
        except Exception:
            # The claim stays "submitting" and stops blocking after SUBMISSION_TIMEOUT.
            raise DomainError(503, "submission_failed") from None
        return self._view({**claimed, "batch_job_id": job_id}, "running"), True

    def items(self, video_id: str, offset: int, limit: int):
        platform = self.video(video_id)["platform"]
        if platform not in self.stores:
            raise DomainError(422, "comments_not_supported")
        return self.stores[platform].page(video_id, offset, limit)

    def start_after_video_backup(self, video_id: str) -> None:
        """Starts the comment backup once a video backup completes (BackupService.on_complete).

        Never raises: the video is already complete, and a failure here only skips the comments,
        which can be started from the video page later.
        """
        try:
            video = self.videos.get(video_id)
            if video and video["platform"] in PLATFORMS:
                self.start(video_id)
        except Exception:
            logger.exception("Comment backup was not started for video %s", video_id)

    def backfill(self, limit: int) -> dict:
        """Starts the comment backup of up to `limit` complete videos that never had one.

        For videos backed up before comment backups existed (newer ones start on completion).
        Only videos without a record are picked, so a failed start is not retried here and one
        pass over the catalog ends; `remaining` is False once nothing is left to start.
        """
        started = skipped = 0
        for videos in batched(self.videos.iterate("complete"), 100, strict=False):
            ids = [v["video_id"] for v in videos if v.get("platform") in PLATFORMS]
            tracked = self.backups.tracked(ids)
            for video_id in ids:
                if video_id in tracked:
                    continue
                if started >= limit:
                    return {"started": started, "skipped": skipped, "remaining": True}
                try:
                    self.start(video_id)
                    started += 1
                except DomainError as error:
                    if error.status == 503:
                        raise  # Batch or SSM is failing: stop instead of claiming more videos.
                    # Being deleted or claimed concurrently: nothing to start for this video.
                    skipped += 1
        return {"started": started, "skipped": skipped, "remaining": False}

    def delete_for_video(self, video: dict) -> None:
        """Removes a video's comment backup while the video deletion holds its lock.

        Raises on failure so the video deletion stops with its lock kept (reconciliation), rather
        than leaving comments of a deleted video behind.
        """
        video_id = video["video_id"]
        backup = self.backups.get(video_id)
        if backup and backup.get("batch_job_id") and backup["state"] in ("submitting", "running"):
            job = self.jobs.get(backup["batch_job_id"])
            if job and job["status"] in ACTIVE:
                self.jobs.terminate(backup["batch_job_id"], "Video deleted")
        # Without the record, an ingest that is still on its way finds no attempt and skips.
        if backup:
            self.backups.delete(video_id)
        store = self.stores.get(video["platform"])
        if store:
            store.delete(video_id)

    def _state(self, backup: dict) -> str:
        state = backup["state"]
        if state == "submitting":
            stale = self.clock() - int(backup["requested_at"]) > SUBMISSION_TIMEOUT
            return "failed" if stale else "submitting"
        if state != "running":
            return state
        job = self.jobs.get(backup["batch_job_id"])
        if job is None:
            return "failed"  # Older than Batch's job retention: it can no longer finish.
        if job["status"] in ACTIVE:
            return "running"
        if job["status"] == "SUCCEEDED":
            return "awaiting_ingest"
        return "failed"

    def _view(self, backup: dict, state: str) -> CommentBackup:
        return CommentBackup(
            video_id=backup["video_id"],
            platform=backup["platform"],
            state=state,
            attempt_id=backup.get("attempt_id"),
            batch_job_id=backup.get("batch_job_id"),
            requested_at=backup.get("requested_at"),
            comment_count=backup.get("comment_count"),
            completed_at=backup.get("completed_at"),
        )
