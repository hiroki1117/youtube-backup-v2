import time
from urllib.parse import unquote_plus

SUFFIX = ".json.gz"


def comment_item(video_id: str, attempt: str, comment: dict) -> dict:
    # Only the fields worth querying are copied; the job's full comment JSON stays in S3.
    timestamp = comment.get("timestamp")
    item = {
        "video_id": video_id,
        "comment_id": comment["id"],
        "parent": comment.get("parent", "root"),
        "text": comment.get("text", ""),
        "like_count": int(comment.get("like_count") or 0),
        "author": comment.get("author"),
        "author_id": comment.get("author_id"),
        "author_is_uploader": bool(comment.get("author_is_uploader")),
        "is_pinned": bool(comment.get("is_pinned")),
        "posted_at": int(timestamp) if timestamp is not None else None,
        # Comments missing from a later fetch keep an older value: deleted comments stay.
        "last_seen_attempt": attempt,
    }
    return {name: value for name, value in item.items() if value is not None}


class YoutubeCommentIngest:
    """Applies a YouTube comment job's comment JSON (youtube/<video_id>/<attempt>.json.gz)."""

    def __init__(self, backups, objects, comments, clock=time.time):
        self.backups = backups
        self.objects = objects
        self.comments = comments
        self.clock = clock

    def ingest_records(self, event: dict) -> dict:
        ingested = 0
        for record in event.get("Records", []):
            if not record.get("eventName", "").startswith("ObjectCreated:"):
                continue
            key = unquote_plus(record["s3"]["object"]["key"])
            parts = key.split("/")
            if len(parts) != 3 or parts[0] != "youtube" or not parts[2].endswith(SUFFIX):
                continue
            video_id, attempt = parts[1], parts[2].removesuffix(SUFFIX)
            backup = self.backups.get(video_id)
            # Only the current attempt is applied; output of a replaced attempt is ignored.
            if not backup or backup["platform"] != "youtube" or backup["attempt_id"] != attempt:
                continue
            info = self.objects.read_json(record["s3"]["bucket"]["name"], key)
            if info.get("id") != video_id:
                continue
            # "comments" is absent or null when comments are disabled on the video.
            items = [comment_item(video_id, attempt, c) for c in info.get("comments") or []]
            # Upsert only: comments are never deleted, so ones removed on YouTube are kept.
            self.comments.put(items)
            ingested += self.backups.complete(video_id, attempt, len(items), int(self.clock()))
        return {"ingested": ingested, "received": len(event.get("Records", []))}
