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

    def iterate(self, status):
        return iter(self.list(status, len(self.items)))

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

    def delete(self, video, token, before_remove=None):
        self.items[video["video_id"]]["deletion_token"] = token
        if before_remove:
            before_remove(video)  # A failure keeps the lock, as in VideoRepository.
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


class MemoryCommentBackups:
    def __init__(self):
        self.items = {}

    def get(self, video_id):
        return deepcopy(self.items.get(video_id))

    def tracked(self, video_ids):
        return {video_id for video_id in video_ids if video_id in self.items}

    def claim(self, video_id, platform, attempt, now, expected):
        current = self.items.get(video_id)
        if (current.get("attempt_id") if current else None) != expected:
            raise DomainError(409, "concurrent_change")
        item = self.items.setdefault(video_id, {"video_id": video_id})
        item.update(platform=platform, attempt_id=attempt, state="submitting", requested_at=now)
        item.pop("batch_job_id", None)
        return self.get(video_id)

    def attach_job(self, video_id, attempt, job_id):
        if self.items[video_id]["attempt_id"] != attempt:
            raise DomainError(409, "concurrent_change")
        self.items[video_id].update(batch_job_id=job_id, state="running")

    def delete(self, video_id):
        self.items.pop(video_id, None)

    def complete(self, video_id, attempt, count, now):
        current = self.items.get(video_id)
        if not current or current["attempt_id"] != attempt:
            return False
        current.update(
            state="complete", comment_count=count, completed_at=now, completed_attempt=attempt
        )
        return True


class MemoryCommentJobs:
    def __init__(self):
        self.items = {}
        self.submissions = []

    def submit(self, platform, url, attempt, key):
        job_id = f"local-comment-job-{len(self.submissions) + 1}"
        self.submissions.append({"platform": platform, "url": url, "key": key})
        self.items[job_id] = {"jobId": job_id, "status": "SUBMITTED"}
        return job_id

    def get(self, job_id):
        return deepcopy(self.items.get(job_id))

    def terminate(self, job_id, reason):
        self.items[job_id].update(status="FAILED", statusReason=reason)


class MemoryCommentObjects:
    def __init__(self):
        self.items = {}

    def read_json(self, bucket, key):
        return deepcopy(self.items[(bucket, key)])

    def delete_prefix(self, prefix):
        for bucket, key in [k for k in self.items if k[1].startswith(prefix)]:
            del self.items[(bucket, key)]


class MemoryYoutubeComments:
    def __init__(self):
        self.items = {}

    def list(self, video_id):
        return [deepcopy(v) for (vid, _), v in self.items.items() if vid == video_id]

    def delete(self, video_id):
        for key in [k for k in self.items if k[0] == video_id]:
            del self.items[key]

    def put(self, items):
        for item in items:
            self.items[(item["video_id"], item["comment_id"])] = deepcopy(item)
