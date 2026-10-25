import time
from datetime import UTC, datetime
from urllib.parse import unquote_plus, urlparse
from uuid import uuid4

from usecases.models import Backup, DomainError, Registration, Video, source_identity

ACTIVE = {"SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"}


class BackupService:
    def __init__(self, videos, jobs, clock=time.time, on_complete=None, on_delete=None):
        self.videos = videos
        self.jobs = jobs
        self.clock = clock
        # on_complete(video_id) runs after a video backup completes and must not raise.
        # on_delete(video) runs under the deletion lock; raising keeps the lock (reconciliation).
        self.on_complete = on_complete
        self.on_delete = on_delete

    def video(self, video_id: str) -> dict:
        video = self.videos.get(video_id)
        if video is None:
            raise DomainError(404, "video_not_found")
        if video.get("deletion_token"):
            raise DomainError(409, "deletion_needs_reconciliation")
        return video

    def backup(self, video_id: str) -> Backup:
        video = self.video(video_id)
        if video["upload_status"] == "complete":
            state = "complete"
        elif video.get("batch_job_id"):
            job = self.jobs.get(video["batch_job_id"])
            if job is None:
                state = "job_unknown"
            elif job["status"] == "SUCCEEDED":
                state = "awaiting_object"
            else:
                state = job["status"].lower()
        else:
            state = video.get("backup_state", "legacy_untracked")
        return Backup(video_id=video_id, state=state, batch_job_id=video.get("batch_job_id"))

    def register(self, url: str) -> tuple[Registration, bool]:
        video_id, _, _ = source_identity(url)
        existing = self.videos.get(video_id)
        if existing:
            return Registration(
                video=Video.model_validate(self.video(video_id)),
                backup=self.backup(video_id),
                already_registered=True,
            ), False
        video = self.videos.make_video(url, int(self.clock()))
        inserted = self.videos.insert(video)
        if not inserted:
            return Registration(
                video=Video.model_validate(self.video(video_id)),
                backup=self.backup(video_id),
                already_registered=True,
            ), False
        backup, started = self.start(video_id, initial=True)
        return Registration(
            video=Video.model_validate(self.video(video_id)),
            backup=backup,
            already_registered=False,
        ), started

    def start(self, video_id: str, *, initial: bool = False) -> tuple[Backup, bool]:
        video = self.video(video_id)
        if video["upload_status"] == "complete":
            return self.backup(video_id), False
        if video.get("batch_job_id"):
            job = self.jobs.get(video["batch_job_id"])
            if job is None:
                raise DomainError(409, "job_needs_reconciliation")
            if job["status"] in ACTIVE or job["status"] == "SUCCEEDED":
                return self.backup(video_id), False
            if job["status"] != "FAILED":
                raise DomainError(409, "job_needs_reconciliation")
        elif not initial:
            if video.get("backup_attempt_id"):
                if video.get("backup_state") == "submitting":
                    # A concurrent request must not submit the same work twice.
                    return self.backup(video_id), False
                raise DomainError(409, "submission_needs_reconciliation")
            raise DomainError(409, "legacy_job_untracked")
        attempt = uuid4().hex  # Internal attempt only: existing video IDs are preserved.
        path = urlparse(video["s3fullpath"])
        filename = "ABCXYZ" + video_id if video_id.startswith("-") else video_id
        now = int(self.clock())
        date = datetime.fromtimestamp(now, UTC).date()
        # New attempt-specific object keys prevent old completion events completing a new retry.
        target = (
            f"s3://{path.netloc}/{video['platform']}/{date.year}/{date.month}/{date.day}/"
            f"attempts/{attempt}/{filename}"
        )
        claimed = self.videos.claim(video, attempt, target, now)
        try:
            job_id = self.jobs.submit(claimed, attempt)
            self.videos.attach_job(video_id, attempt, job_id)
        except Exception:
            # Submit may have reached Batch; do not blindly retry after a timeout/attach failure.
            try:
                self.videos.unknown_submission(video_id, attempt)
            except Exception:
                pass
            raise DomainError(503, "submission_needs_reconciliation") from None
        state = "complete" if self.video(video_id)["upload_status"] == "complete" else "submitted"
        return Backup(video_id=video_id, state=state, batch_job_id=job_id), True

    def delete(self, video_id: str) -> None:
        video = self.video(video_id)
        if video["upload_status"] != "complete":
            # An unfinished backup is cancelled (DELETE /videos/{id}/backup), not deleted.
            raise DomainError(409, "backup_not_complete")
        self.videos.delete(video, uuid4().hex, before_remove=self.on_delete)

    def cancel(self, video_id: str) -> None:
        """Cancel an unfinished backup: stop its Batch job, then remove the video record.

        The job is stopped so the scheduled retry cannot restart it. Nothing is changed unless
        the outcome is certain; see the 409 cases below.
        """
        video = self.video(video_id)
        if video["upload_status"] == "complete":
            raise DomainError(409, "backup_already_complete")
        job_id = video.get("batch_job_id")
        active = False
        if job_id:
            job = self.jobs.get(job_id)
            if job is None:
                raise DomainError(409, "job_needs_reconciliation")
            if job["status"] == "SUCCEEDED":
                # The object is on its way; the S3 notification will complete the record.
                raise DomainError(409, "backup_object_needs_reconciliation")
            active = job["status"] in ACTIVE
            if not active and job["status"] != "FAILED":
                raise DomainError(409, "job_needs_reconciliation")
        elif video.get("backup_attempt_id"):
            # Submission in flight or unknown: a job may exist that cannot be found.
            if video.get("backup_state") == "submitting":
                raise DomainError(409, "concurrent_change")
            raise DomainError(409, "submission_needs_reconciliation")
        # A FAILED job does not prove nothing was uploaded: yt-dlp appends the actual extension
        # and its S3 completion notification may arrive after the job ends. Check before
        # stopping the job so a refusal never leaves a stopped job that the retry would restart.
        if self.videos.has_object(video):
            raise DomainError(409, "backup_object_needs_reconciliation")
        if active:
            self.jobs.terminate(job_id, "Cancelled by the user")
        self.videos.cancel(video)

    def playback(self, video_id: str) -> str:
        video = self.video(video_id)
        if video["upload_status"] != "complete":
            raise DomainError(409, "backup_not_complete")
        return self.videos.playback_url(video)

    def complete_records(self, event: dict) -> dict:
        updated = 0
        for record in event.get("Records", []):
            if not record.get("eventName", "").startswith("ObjectCreated:"):
                continue
            key = unquote_plus(record["s3"]["object"]["key"])
            bucket = record["s3"]["bucket"]["name"]
            video_id = key.rsplit("/", 1)[-1].split(".")[0]
            video = self.videos.get(video_id)
            # A valid ID may naturally begin ABCXYZ-. Prefer its exact ID; decode the
            # legacy leading-minus filename workaround only when the exact ID is absent.
            if video is None and video_id.startswith("ABCXYZ-"):
                video_id = video_id[6:]
                video = self.videos.get(video_id)
            if not video or video["upload_status"] != "init" or video.get("deletion_token"):
                continue
            actual = f"s3://{bucket}/{key}"
            expected = video["s3fullpath"]
            if actual != expected and not actual.startswith(expected + "."):
                continue
            # Legacy paths lack an attempt identifier; also reject events preceding the request.
            event_time = record.get("eventTime")
            if not event_time:
                continue
            try:
                occurred = datetime.fromisoformat(event_time.replace("Z", "+00:00")).timestamp()
                requested = int(video["request_timestamp"])
            except ValueError, KeyError, TypeError:
                continue
            if occurred < requested:
                continue
            if self.videos.complete(video, actual):
                updated += 1
                if self.on_complete:
                    self.on_complete(video_id)
        return {"updated": updated, "received": len(event.get("Records", []))}

    def retry_failed(self) -> dict:
        started = skipped = 0
        # Bounded work: legacy init-only items must be reconciled, not assumed failed.
        for video in self.videos.list("init", 100):
            if not video.get("batch_job_id") or video.get("deletion_token"):
                skipped += 1
                continue
            try:
                _, created = self.start(video["video_id"])
                started += int(created)
                skipped += int(not created)
            except DomainError as error:
                if error.status == 503:
                    raise
                skipped += 1
        return {"started": started, "skipped": skipped}
