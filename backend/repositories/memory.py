from copy import deepcopy

from usecases.models import DomainError, source_identity


class MemoryVideos:
    """Local/test storage. Never selected by the Lambda handlers."""

    def __init__(self):
        self.items = {}

    def get(self, video_id):
        return deepcopy(self.items.get(video_id))

    def list(self, status, limit):
        return [deepcopy(v) for v in self.items.values() if v["upload_status"] == status][:limit]

    def make_video(self, url, now):
        video_id, platform, normalized = source_identity(url)
        return {
            "video_id": video_id,
            "video_url": normalized,
            "platform": platform,
            "title": "Local preview",
            "backupdate": "2026-10-12",
            "upload_status": "init",
            "request_timestamp": str(now),
            "s3fullpath": f"s3://local-preview/{video_id}",
        }

    def insert(self, video):
        if video["video_id"] in self.items:
            return False
        self.items[video["video_id"]] = deepcopy(video)
        return True

    def update_title(self, video_id, title):
        self.items[video_id]["title"] = title
        return self.get(video_id)

    def claim(self, video, attempt, path, now):
        current = self.items.get(video["video_id"])
        if (
            not current
            or current.get("deletion_token")
            or current["upload_status"] != "init"
            or current.get("backup_attempt_id") != video.get("backup_attempt_id")
        ):
            raise DomainError(409, "concurrent_change")
        current.update(
            backup_attempt_id=attempt,
            s3fullpath=path,
            request_timestamp=str(now),
            backup_state="submitting",
            upload_status="init",
        )
        current.pop("batch_job_id", None)
        return self.get(video["video_id"])

    def attach_job(self, video_id, attempt, job_id):
        if self.items[video_id]["backup_attempt_id"] != attempt:
            raise DomainError(409, "concurrent_change")
        self.items[video_id]["batch_job_id"] = job_id

    def unknown_submission(self, video_id, attempt):
        if self.items[video_id]["upload_status"] == "init":
            self.items[video_id]["backup_state"] = "submission_unknown"

    def complete(self, video, actual_path):
        current = self.items.get(video["video_id"])
        if (
            not current
            or current.get("deletion_token")
            or current["upload_status"] != "init"
            or current["s3fullpath"] != video["s3fullpath"]
        ):
            return False
        current.update(upload_status="complete", s3fullpath=actual_path, backup_state="complete")
        return True

    def playback_url(self, video):
        return "https://local-preview.invalid/" + video["video_id"]

    def has_object(self, video):
        return False

    def cancel(self, video):
        current = self.items.get(video["video_id"])
        if (
            not current
            or current["upload_status"] != "init"
            or current["s3fullpath"] != video["s3fullpath"]
            or current.get("deletion_token")
        ):
            raise DomainError(409, "concurrent_change")
        del self.items[video["video_id"]]

    def delete(self, video, token):
        del self.items[video["video_id"]]


class MemoryJobs:
    def __init__(self):
        self.items = {}
        self.submissions = 0

    def submit(self, video, attempt):
        self.submissions += 1
        job_id = f"local-job-{self.submissions}"
        self.items[job_id] = {"jobId": job_id, "status": "SUBMITTED"}
        return job_id

    def terminate(self, job_id, reason):
        self.items[job_id]["status"] = "FAILED"
        self.items[job_id]["statusReason"] = reason

    def get(self, job_id):
        return deepcopy(self.items.get(job_id))
