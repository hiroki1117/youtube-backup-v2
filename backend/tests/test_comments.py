import gzip
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from repositories.comments import (
    CommentBackupRepository,
    CommentJobRepository,
    CommentObjectRepository,
)
from repositories.memory import MemoryCommentObjects, MemoryYoutubeComments
from usecases.comments import SUBMISSION_TIMEOUT
from usecases.models import DomainError, source_identity
from usecases.youtube_comments import YoutubeCommentIngest, comment_item

URL = "https://www.youtube.com/watch?v=abcdefghijk"
VIDEO_ID = "abcdefghijk"
NOW = 1791763200


def backed_up(service, url=URL):
    """Register a video and complete its (video) backup."""
    service.register(url)
    video_id = source_identity(url)[0]
    service.videos.items[video_id]["upload_status"] = "complete"
    return video_id


def info(video_id=VIDEO_ID, comments=None):
    return {"id": video_id, "comment_count": 2, "comments": comments}


COMMENTS = [
    {
        "id": "Ugx1",
        "parent": "root",
        "text": "first",
        "like_count": 7,
        "author": "@uploader",
        "author_id": "UC1",
        "author_thumbnail": "https://yt3.ggpht.com/a",
        "author_is_uploader": True,
        "is_pinned": True,
        "timestamp": 1792713600,
    },
    {"id": "Ugx1.reply", "parent": "Ugx1", "text": "reply", "author": "@viewer"},
]


def s3_event(key, bucket="comments-bucket", name="ObjectCreated:Put"):
    return {
        "Records": [{"eventName": name, "s3": {"bucket": {"name": bucket}, "object": {"key": key}}}]
    }


@pytest.fixture
def ingest(comment_service):
    return YoutubeCommentIngest(
        comment_service.backups, MemoryCommentObjects(), MemoryYoutubeComments(), clock=lambda: NOW
    )


def stored(ingest, key, body, bucket="comments-bucket"):
    ingest.objects.items[(bucket, key)] = body
    return ingest.ingest_records(s3_event(key, bucket))


def test_start_submits_a_platform_job_and_does_not_resubmit_while_running(service, comment_service):
    backed_up(service)
    assert comment_service.status(VIDEO_ID).state == "not_started"
    result, started = comment_service.start(VIDEO_ID)
    assert started and result.state == "running" and result.batch_job_id
    submission = comment_service.jobs.submissions[0]
    assert submission == {
        "platform": "youtube",
        "url": URL,
        "key": f"youtube/{VIDEO_ID}/{result.attempt_id}.json.gz",
    }
    again, started = comment_service.start(VIDEO_ID)
    assert not started and again.attempt_id == result.attempt_id
    assert len(comment_service.jobs.submissions) == 1


def test_start_rejects_unknown_unfinished_and_unsupported_videos(service, comment_service):
    with pytest.raises(DomainError) as error:
        comment_service.start(VIDEO_ID)
    assert (error.value.status, error.value.code) == (404, "video_not_found")
    service.register(URL)
    with pytest.raises(DomainError) as error:
        comment_service.start(VIDEO_ID)
    assert (error.value.status, error.value.code) == (409, "backup_not_complete")
    other = backed_up(service, "https://example.invalid/video.mp4")
    with pytest.raises(DomainError) as error:
        comment_service.start(other)
    assert (error.value.status, error.value.code) == (422, "comments_not_supported")
    assert comment_service.jobs.submissions == []


@pytest.mark.parametrize(
    ("status", "state", "restartable"),
    [
        ("RUNNING", "running", False),
        ("SUCCEEDED", "awaiting_ingest", True),
        ("FAILED", "failed", True),
    ],
)
def test_job_status_decides_state_and_restart(service, comment_service, status, state, restartable):
    backed_up(service)
    first, _ = comment_service.start(VIDEO_ID)
    comment_service.jobs.items[first.batch_job_id]["status"] = status
    assert comment_service.status(VIDEO_ID).state == state
    second, started = comment_service.start(VIDEO_ID)
    assert started is restartable
    assert (second.attempt_id != first.attempt_id) is restartable


def test_job_missing_from_batch_counts_as_failed(service, comment_service):
    backed_up(service)
    first, _ = comment_service.start(VIDEO_ID)
    del comment_service.jobs.items[first.batch_job_id]
    assert comment_service.status(VIDEO_ID).state == "failed"
    assert comment_service.start(VIDEO_ID)[1] is True


def test_interrupted_submission_blocks_only_until_the_timeout(service, comment_service):
    backed_up(service)
    comment_service.backups.claim(VIDEO_ID, "youtube", "lost", NOW, expected=None)
    assert comment_service.status(VIDEO_ID).state == "submitting"
    assert comment_service.start(VIDEO_ID)[1] is False
    comment_service.clock = lambda: NOW + SUBMISSION_TIMEOUT + 1
    assert comment_service.status(VIDEO_ID).state == "failed"
    assert comment_service.start(VIDEO_ID)[1] is True


def test_failed_submission_returns_503_and_keeps_a_releasable_claim(service, comment_service):
    backed_up(service)
    comment_service.jobs.submit = Mock(side_effect=RuntimeError("timeout"))
    with pytest.raises(DomainError) as error:
        comment_service.start(VIDEO_ID)
    assert (error.value.status, error.value.code) == (503, "submission_failed")
    assert comment_service.status(VIDEO_ID).state == "submitting"


def test_ingest_applies_the_current_attempt_and_completes_it(service, comment_service, ingest):
    backed_up(service)
    started, _ = comment_service.start(VIDEO_ID)
    key = f"youtube/{VIDEO_ID}/{started.attempt_id}.json.gz"
    assert stored(ingest, key, info(comments=COMMENTS)) == {"ingested": 1, "received": 1}
    assert ingest.comments.items[(VIDEO_ID, "Ugx1")] == {
        "video_id": VIDEO_ID,
        "comment_id": "Ugx1",
        "parent": "root",
        "text": "first",
        "like_count": 7,
        "author": "@uploader",
        "author_id": "UC1",
        "author_is_uploader": True,
        "is_pinned": True,
        "posted_at": 1792713600,
        "last_seen_attempt": started.attempt_id,
    }
    assert ingest.comments.items[(VIDEO_ID, "Ugx1.reply")]["parent"] == "Ugx1"
    status = comment_service.status(VIDEO_ID)
    assert (status.state, status.comment_count, status.completed_at) == ("complete", 2, NOW)


def test_refetch_keeps_comments_deleted_on_youtube(service, comment_service, ingest):
    backed_up(service)
    first, _ = comment_service.start(VIDEO_ID)
    stored(ingest, f"youtube/{VIDEO_ID}/{first.attempt_id}.json.gz", info(comments=COMMENTS))
    second, _ = comment_service.start(VIDEO_ID)
    stored(ingest, f"youtube/{VIDEO_ID}/{second.attempt_id}.json.gz", info(comments=COMMENTS[:1]))
    assert ingest.comments.items[(VIDEO_ID, "Ugx1")]["last_seen_attempt"] == second.attempt_id
    # Gone from the second fetch, yet kept with the attempt that last saw it.
    assert ingest.comments.items[(VIDEO_ID, "Ugx1.reply")]["last_seen_attempt"] == first.attempt_id
    assert comment_service.status(VIDEO_ID).comment_count == 1


def test_ingest_ignores_replaced_attempts_and_foreign_objects(service, comment_service, ingest):
    backed_up(service)
    first, _ = comment_service.start(VIDEO_ID)
    comment_service.jobs.items[first.batch_job_id]["status"] = "FAILED"
    second, _ = comment_service.start(VIDEO_ID)
    body = info(comments=COMMENTS)
    for key in (
        f"youtube/{VIDEO_ID}/{first.attempt_id}.json.gz",  # replaced attempt
        f"youtube/unknownvide/{second.attempt_id}.json.gz",  # no comment backup
        f"other/{VIDEO_ID}/{second.attempt_id}.json.gz",  # other platform prefix
        f"youtube/{VIDEO_ID}/{second.attempt_id}.json",  # unexpected name
    ):
        assert stored(ingest, key, body)["ingested"] == 0
    mismatched = info(video_id="zzzzzzzzzzz", comments=COMMENTS)
    key = f"youtube/{VIDEO_ID}/{second.attempt_id}.json.gz"
    assert stored(ingest, key, mismatched)["ingested"] == 0
    removed = s3_event(key, name="ObjectRemoved:Delete")
    assert ingest.ingest_records(removed)["ingested"] == 0
    assert ingest.comments.items == {}
    assert comment_service.status(VIDEO_ID).state == "running"


def test_video_with_comments_disabled_completes_with_zero(service, comment_service, ingest):
    backed_up(service)
    started, _ = comment_service.start(VIDEO_ID)
    key = f"youtube/{VIDEO_ID}/{started.attempt_id}.json.gz"
    assert stored(ingest, key, {"id": VIDEO_ID})["ingested"] == 1
    assert comment_service.status(VIDEO_ID).comment_count == 0


def test_ids_starting_with_a_minus_keep_their_own_key(service, comment_service, ingest):
    # The video job renames such files (ABCXYZ prefix); the comment job keeps the plain ID.
    video_id = backed_up(service, "https://youtu.be/-abcdefghij")
    started, _ = comment_service.start(video_id)
    key = f"youtube/{video_id}/{started.attempt_id}.json.gz"
    assert stored(ingest, key, info(video_id=video_id, comments=COMMENTS))["ingested"] == 1


def test_comment_item_drops_missing_values():
    assert comment_item("v", "a", {"id": "c"}) == {
        "video_id": "v",
        "comment_id": "c",
        "parent": "root",
        "text": "",
        "like_count": 0,
        "author_is_uploader": False,
        "is_pinned": False,
        "last_seen_attempt": "a",
    }


def test_api_starts_and_reports_comment_backup(client, service):
    backed_up(service)
    assert client.get(f"/videos/{VIDEO_ID}/comments").json()["state"] == "not_started"
    response = client.post(f"/videos/{VIDEO_ID}/comments")
    assert response.status_code == 202 and response.json()["state"] == "running"
    assert client.post(f"/videos/{VIDEO_ID}/comments").status_code == 200
    assert client.get(f"/videos/{VIDEO_ID}/comments").json()["state"] == "running"
    assert client.post("/videos/zzzzzzzzzzz/comments").status_code == 404


def conditional_failure():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


def backups_with(table):
    repo = object.__new__(CommentBackupRepository)
    repo.table = table
    return repo


def test_claim_locks_on_the_inspected_attempt():
    table = Mock()
    table.update_item.return_value = {"Attributes": {"video_id": VIDEO_ID}}
    backups_with(table).claim(VIDEO_ID, "youtube", "new", NOW, expected=None)
    assert table.update_item.call_args.kwargs["ConditionExpression"] == (
        "attribute_not_exists(video_id)"
    )
    backups_with(table).claim(VIDEO_ID, "youtube", "new", NOW, expected="old")
    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ConditionExpression"] == "attempt_id = :expected"
    assert kwargs["ExpressionAttributeValues"][":expected"] == "old"
    table.update_item.side_effect = conditional_failure()
    with pytest.raises(DomainError) as error:
        backups_with(table).claim(VIDEO_ID, "youtube", "new", NOW, expected="old")
    assert error.value.code == "concurrent_change"


def test_complete_reports_a_replaced_attempt_as_not_applied():
    table = Mock()
    assert backups_with(table).complete(VIDEO_ID, "a", 2, NOW) is True
    table.update_item.side_effect = conditional_failure()
    assert backups_with(table).complete(VIDEO_ID, "a", 2, NOW) is False


def test_job_submission_uses_the_platform_definition(monkeypatch):
    monkeypatch.setenv("SSM_COOKIE_S3_PATH_PARAMETER", "/p/cookie")
    monkeypatch.setenv("COMMENTS_BUCKET", "comments-bucket")
    monkeypatch.setenv("COMMENTS_JOB_QUEUE_NAME", "comments-queue")
    monkeypatch.setenv("YOUTUBE_COMMENTS_JOB_DEFINITION_NAME", "youtube-comments")
    monkeypatch.setenv("YOUTUBE_COMMENTS_JOB_REVISION", "3")
    repo = object.__new__(CommentJobRepository)
    repo.ssm = Mock()
    repo.ssm.get_parameter.return_value = {"Parameter": {"Value": "s3://cookies/c.txt"}}
    repo.batch = Mock()
    repo.batch.submit_job.return_value = {"jobId": "job-1"}
    assert repo.submit("youtube", URL, "att", "youtube/v/att.json.gz") == "job-1"
    kwargs = repo.batch.submit_job.call_args.kwargs
    assert kwargs["jobName"] == "youtube-comments-att"
    assert kwargs["jobQueue"] == "comments-queue"
    assert kwargs["jobDefinition"] == "youtube-comments:3"
    assert kwargs["containerOverrides"]["environment"] == [
        {"name": "URL", "value": URL},
        {"name": "S3PATH", "value": "s3://comments-bucket/youtube/v/att.json.gz"},
        {"name": "COOKIE_S3_PATH", "value": "s3://cookies/c.txt"},
    ]


def test_object_repository_reads_gzip_json():
    repo = object.__new__(CommentObjectRepository)
    repo.s3 = Mock()
    repo.s3.get_object.return_value = {"Body": Mock(read=lambda: gzip.compress(b'{"id": "v"}'))}
    assert repo.read_json("b", "k") == {"id": "v"}
    assert repo.s3.get_object.call_args.kwargs == {"Bucket": "b", "Key": "k"}
