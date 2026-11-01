import time
from collections import defaultdict
from urllib.parse import unquote_plus

from usecases.models import YoutubeComment, YoutubeCommentPage, YoutubeCommentThread

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


def comment_view(item: dict, completed_attempt: str | None) -> dict:
    fields = {name: item[name] for name in YoutubeComment.model_fields if name in item}
    # Unknown (False) until an attempt completes with completed_attempt recorded.
    fields["removed"] = (
        completed_attempt is not None and item.get("last_seen_attempt") != completed_attempt
    )
    return fields


def comment_threads(items: list[dict], completed_attempt: str | None) -> list[YoutubeCommentThread]:
    """Top-level comments with their replies: pinned first, then newest; replies oldest first."""
    parents, replies = {}, defaultdict(list)
    for item in items:
        if item.get("parent", "root") == "root":
            parents[item["comment_id"]] = item
        else:
            replies[item["parent"]].append(item)
    threads = []
    for comment_id, item in parents.items():
        children = sorted(replies.pop(comment_id, []), key=lambda r: r.get("posted_at") or 0)
        threads.append(
            YoutubeCommentThread(
                **comment_view(item, completed_attempt),
                replies=[YoutubeComment(**comment_view(r, completed_attempt)) for r in children],
            )
        )
    # Replies whose parent was not fetched (e.g. cut off by the comment limit) stand alone.
    for orphans in replies.values():
        threads.extend(YoutubeCommentThread(**comment_view(r, completed_attempt)) for r in orphans)
    threads.sort(key=lambda t: (not t.is_pinned, -(t.posted_at or 0), t.comment_id))
    return threads


class YoutubeCommentStore:
    """A video's YouTube comments: pages of threads (GET /videos/{id}/comments) and deletion."""

    def __init__(self, backups, comments, objects):
        self.backups = backups
        self.comments = comments
        self.objects = objects

    def delete(self, video_id: str) -> None:
        # Originals first: if the table deletion then fails, a retry still finds what is left.
        self.objects.delete_prefix(f"youtube/{video_id}/")
        self.comments.delete(video_id)

    def page(self, video_id: str, offset: int, limit: int) -> YoutubeCommentPage:
        backup = self.backups.get(video_id)
        items = self.comments.list(video_id)
        threads = comment_threads(items, backup.get("completed_attempt") if backup else None)
        end = offset + limit
        return YoutubeCommentPage(
            total_threads=len(threads),
            total_comments=len(items),
            threads=threads[offset:end],
            next_offset=end if end < len(threads) else None,
        )
