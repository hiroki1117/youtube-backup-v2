from unittest.mock import Mock

import pytest

from entrypoints.comments_backfill import LIMIT, backfill
from repositories.comments import CommentBackupRepository
from repositories.videos import VideoRepository
from usecases.models import DomainError


def backed_up(service, count):
    """Register `count` YouTube videos and complete their (video) backups."""
    ids = [f"vid{i:08d}" for i in range(count)]
    for video_id in ids:
        service.register(f"https://www.youtube.com/watch?v={video_id}")
        service.videos.items[video_id]["upload_status"] = "complete"
    return ids


def test_backfill_starts_up_to_the_limit_and_finishes_after_one_pass(service, comment_service):
    ids = backed_up(service, 5)
    assert comment_service.backfill(2) == {"started": 2, "skipped": 0, "remaining": True}
    assert comment_service.backfill(2) == {"started": 2, "skipped": 0, "remaining": True}
    assert comment_service.backfill(2) == {"started": 1, "skipped": 0, "remaining": False}
    assert {comment_service.status(video_id).state for video_id in ids} == {"running"}
    assert len(comment_service.jobs.submissions) == 5
    assert comment_service.backfill(2) == {"started": 0, "skipped": 0, "remaining": False}


def test_backfill_picks_only_complete_youtube_videos_without_a_record(service, comment_service):
    done, failed, todo = backed_up(service, 3)
    comment_service.start(done)
    comment_service.backups.items[failed] = {"video_id": failed, "state": "failed"}
    service.register("https://www.youtube.com/watch?v=unfinished1")  # still init
    other = "https://example.invalid/video.mp4"
    service.register(other)
    next(v for v in service.videos.items.values() if v["video_url"] == other).update(
        upload_status="complete"
    )
    assert comment_service.backfill(10) == {"started": 1, "skipped": 0, "remaining": False}
    assert comment_service.jobs.submissions[-1]["url"].endswith(todo)
    assert comment_service.backups.get(failed)["state"] == "failed"  # left to the video page


def test_backfill_does_not_retry_a_video_whose_fetch_failed(service, comment_service):
    # e.g. the video was removed from YouTube: yt-dlp exits non-zero and the job FAILS, but the
    # record claimed before submission stays, so the next run does not pick the video again.
    (gone,) = backed_up(service, 1)
    assert comment_service.backfill(1)["started"] == 1
    job_id = comment_service.backups.get(gone)["batch_job_id"]
    comment_service.jobs.items[job_id]["status"] = "FAILED"
    assert comment_service.status(gone).state == "failed"
    assert comment_service.backfill(1) == {"started": 0, "skipped": 0, "remaining": False}
    assert len(comment_service.jobs.submissions) == 1


def test_backfill_skips_videos_being_deleted(service, comment_service):
    deleting, todo = backed_up(service, 2)
    service.videos.items[deleting]["deletion_token"] = "t"
    assert comment_service.backfill(10) == {"started": 1, "skipped": 1, "remaining": False}
    assert comment_service.status(todo).state == "running"


def test_backfill_stops_when_submission_fails(service, comment_service):
    first, second = backed_up(service, 2)
    comment_service.jobs.submit = Mock(side_effect=RuntimeError("Batch unavailable"))
    with pytest.raises(DomainError) as error:
        comment_service.backfill(10)
    assert error.value.status == 503
    assert len(comment_service.backups.items) == 1  # the second video was not claimed


def test_handler_disables_the_schedule_once_nothing_is_left(service, comment_service):
    backed_up(service, 2)
    disable = Mock()
    assert backfill(comment_service, {"limit": 1}, disable)["remaining"] is True
    disable.assert_not_called()
    assert backfill(comment_service, {"limit": 1}, disable)["remaining"] is False
    disable.assert_called_once_with()


def test_scheduled_runs_use_the_app_limit_and_manual_runs_may_override_it(service, comment_service):
    backed_up(service, LIMIT + 2)
    # A scheduled event carries no limit of its own.
    scheduled = {"source": "aws.events", "detail-type": "Scheduled Event", "detail": {}}
    assert backfill(comment_service, scheduled, Mock())["started"] == LIMIT
    assert backfill(comment_service, {"limit": 1}, Mock())["started"] == 1


def test_video_repository_iterates_every_query_page():
    repo = object.__new__(VideoRepository)
    repo.table = Mock()
    repo.table.query.side_effect = [
        {"Items": [{"video_id": "a"}], "LastEvaluatedKey": {"k": 1}},
        {"Items": [{"video_id": "b"}]},
    ]
    assert [v["video_id"] for v in repo.iterate("complete")] == ["a", "b"]
    kwargs = repo.table.query.call_args.kwargs
    assert kwargs["IndexName"] == "upload_status-backupdate-index"
    assert kwargs["ProjectionExpression"] == "video_id, platform"
    assert kwargs["ExclusiveStartKey"] == {"k": 1}


def test_backup_repository_reads_tracked_ids_and_resends_unprocessed_keys():
    repo = object.__new__(CommentBackupRepository)
    repo.table = Mock()
    repo.table.name = "backups"
    repo.dynamodb = Mock()
    repo.dynamodb.batch_get_item.side_effect = [
        {
            "Responses": {"backups": [{"video_id": "a"}]},
            "UnprocessedKeys": {"backups": {"Keys": [{"video_id": "b"}]}},
        },
        {"Responses": {"backups": []}, "UnprocessedKeys": {}},
    ]
    assert repo.tracked(["a", "b", "c"]) == {"a"}
    first, second = repo.dynamodb.batch_get_item.call_args_list
    assert first.kwargs["RequestItems"]["backups"]["Keys"] == [
        {"video_id": "a"},
        {"video_id": "b"},
        {"video_id": "c"},
    ]
    assert second.kwargs["RequestItems"]["backups"]["Keys"] == [{"video_id": "b"}]
