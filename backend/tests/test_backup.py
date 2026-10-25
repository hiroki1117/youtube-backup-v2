from unittest.mock import Mock

import pytest

from entrypoints.scrapbox_scan import scan_scrapbox
from usecases.models import DomainError

URL = "https://www.youtube.com/watch?v=abcdefghijk"


def event_for(video, *, path=None, event_time="2026-10-12T00:01:00Z"):
    target = path or video["s3fullpath"] + ".mp4"
    bucket, key = target[5:].split("/", 1)
    return {
        "Records": [
            {
                "eventName": "ObjectCreated:Put",
                "eventTime": event_time,
                "s3": {"bucket": {"name": bucket}, "object": {"key": key}},
            }
        ]
    }


def test_failed_retry_separates_attempts_and_rejects_old_events(service):
    service.register(URL)
    previous = service.video("abcdefghijk")
    service.jobs.items[previous["batch_job_id"]]["status"] = "FAILED"
    result, started = service.start("abcdefghijk")
    assert started and result.batch_job_id != previous["batch_job_id"]
    current = service.video("abcdefghijk")
    assert current["backup_attempt_id"] != previous["backup_attempt_id"]
    assert current["s3fullpath"] != previous["s3fullpath"]
    assert service.complete_records(event_for(previous))["updated"] == 0
    assert service.complete_records(event_for(current))["updated"] == 1
    assert service.complete_records(event_for(current))["updated"] == 0
    assert service.backup("abcdefghijk").state == "complete"
    assert service.start("abcdefghijk")[1] is False


def test_deleted_record_is_not_recreated_and_multirecord_events(service):
    service.register(URL)
    current = service.video("abcdefghijk")
    event = event_for(current)
    event["Records"].insert(0, {"eventName": "ObjectRemoved:Delete"})
    assert service.complete_records(event)["updated"] == 1
    service.delete("abcdefghijk")
    assert service.complete_records(event)["updated"] == 0
    assert service.videos.get("abcdefghijk") is None


def test_old_wrong_bucket_and_missing_time_events(service):
    service.register(URL)
    current = service.video("abcdefghijk")
    assert (
        service.complete_records(event_for(current, event_time="2020-01-01T00:00:00Z"))["updated"]
        == 0
    )
    event = event_for(current)
    event["Records"][0]["s3"]["bucket"]["name"] = "other-bucket"
    assert service.complete_records(event)["updated"] == 0
    event = event_for(current)
    event["Records"][0].pop("eventTime")
    assert service.complete_records(event)["updated"] == 0


def test_unknown_submission_never_retries_automatically(service):
    service.jobs.submit = Mock(side_effect=TimeoutError("ambiguous AWS transport failure"))
    with pytest.raises(DomainError, match="submission_needs_reconciliation"):
        service.register(URL)
    assert service.video("abcdefghijk")["backup_state"] == "submission_unknown"
    with pytest.raises(DomainError, match="submission_needs_reconciliation"):
        service.start("abcdefghijk")
    assert service.jobs.submit.call_count == 1
    assert service.retry_failed() == {"started": 0, "skipped": 1}


def test_job_attachment_failure_does_not_resubmit(service):
    service.videos.attach_job = Mock(
        side_effect=RuntimeError("write failed after accepted submission")
    )
    with pytest.raises(DomainError):
        service.register(URL)
    assert service.jobs.submissions == 1
    with pytest.raises(DomainError):
        service.start("abcdefghijk")
    assert service.jobs.submissions == 1


def test_completion_before_job_attachment_is_preserved(service):
    original = service.jobs.submit

    def submit(video, attempt):
        service.complete_records(event_for(video))
        return original(video, attempt)

    service.jobs.submit = submit
    service.register(URL)
    assert service.backup("abcdefghijk").state == "complete"
    assert service.video("abcdefghijk").get("batch_job_id")


def test_legacy_records_untouched_and_retry_only_failed_jobs(service):
    service.register(URL)
    tracked = service.video("abcdefghijk")
    legacy = {**tracked, "video_id": "legacy-video", "title": "existing legacy title"}
    for key in ["batch_job_id", "backup_attempt_id", "backup_state"]:
        legacy.pop(key)
    service.videos.items["legacy-video"] = legacy.copy()
    assert service.backup("legacy-video").state == "legacy_untracked"
    with pytest.raises(DomainError, match="legacy_job_untracked"):
        service.start("legacy-video")
    assert service.retry_failed() == {"started": 0, "skipped": 2}
    assert service.videos.items["legacy-video"] == legacy
    service.jobs.items[tracked["batch_job_id"]]["status"] = "FAILED"
    assert service.retry_failed() == {"started": 1, "skipped": 1}
    # An untracked legacy record that never produced an object can be dismissed.
    service.delete("legacy-video")
    assert service.videos.get("legacy-video") is None


def test_concurrent_completion_blocks_retry_claim(service):
    service.register(URL)
    tracked = service.video("abcdefghijk")
    service.jobs.items[tracked["batch_job_id"]]["status"] = "FAILED"
    original = service.videos.claim

    def claim(video, attempt, path, now):
        service.complete_records(event_for(video))
        return original(video, attempt, path, now)

    service.videos.claim = claim
    with pytest.raises(DomainError, match="concurrent_change"):
        service.start("abcdefghijk")
    assert service.jobs.submissions == 1
    assert service.backup("abcdefghijk").state == "complete"


def test_missing_job_and_deletion_lock_block_mutations(service):
    service.register(URL)
    current = service.video("abcdefghijk")
    service.jobs.items.pop(current["batch_job_id"])
    assert service.backup("abcdefghijk").state == "job_unknown"
    with pytest.raises(DomainError):
        service.start("abcdefghijk")
    service.videos.items["abcdefghijk"]["deletion_token"] = "reconciliation-required"
    with pytest.raises(DomainError, match="deletion_needs_reconciliation"):
        service.video("abcdefghijk")
    assert service.complete_records(event_for(current))["updated"] == 0


def test_scrapbox_duplicate_urls_share_registration_path(service):
    source = Mock()
    source.video_urls.return_value = [URL, URL]
    assert scan_scrapbox(service, source) == {"started": 1, "existing": 1}
    assert service.jobs.submissions == 1


def test_negative_video_id_and_encoded_s3_key(service):
    service.register("https://youtu.be/-abcdefghij")
    video = service.video("-abcdefghij")
    assert video["s3fullpath"].endswith("ABCXYZ-abcdefghij")
    assert service.complete_records(event_for(video))["updated"] == 1
    assert service.video("-abcdefghij")["video_id"] == "-abcdefghij"


def test_natural_workaround_prefix_keeps_existing_id(service):
    service.register("https://youtu.be/ABCXYZ-abcd")
    video = service.video("ABCXYZ-abcd")
    assert service.complete_records(event_for(video))["updated"] == 1
    assert service.video("ABCXYZ-abcd")["video_id"] == "ABCXYZ-abcd"


def test_failed_job_with_uploaded_object_and_delayed_event_is_not_deleted(service):
    service.register("https://youtu.be/abcdefghijk")
    video = service.video("abcdefghijk")
    actual_path = video["s3fullpath"] + ".mp4"
    objects = {actual_path}
    original_delete = service.videos.delete

    def delete(item, token):
        objects.discard(item["s3fullpath"])
        original_delete(item, token)

    service.videos.delete = Mock(side_effect=delete)
    service.videos.has_object = Mock(return_value=True)
    service.jobs.items[video["batch_job_id"]]["status"] = "FAILED"
    with pytest.raises(DomainError, match="backup_object_needs_reconciliation"):
        service.delete("abcdefghijk")
    service.videos.delete.assert_not_called()
    assert service.videos.get("abcdefghijk") == video
    assert objects == {actual_path}
    # Late completion resolves the exact object. Only then may deletion remove both.
    assert service.complete_records(event_for(video))["updated"] == 1
    assert service.video("abcdefghijk")["s3fullpath"] == actual_path
    service.delete("abcdefghijk")
    assert not objects
    assert service.videos.get("abcdefghijk") is None


def test_cancel_stops_active_job_and_scheduled_retry_cannot_restart_it(service):
    service.register(URL)
    video = service.video("abcdefghijk")
    job_id = video["batch_job_id"]
    service.jobs.terminate = Mock(wraps=service.jobs.terminate)
    service.delete("abcdefghijk")
    service.jobs.terminate.assert_called_once_with(job_id, "Cancelled by the user")
    assert service.videos.get("abcdefghijk") is None
    assert service.retry_failed() == {"started": 0, "skipped": 0}
    assert service.jobs.submissions == 1
    # The same URL can be registered again afterwards.
    assert service.register(URL)[1] is True


def test_cancel_failed_job_removes_record_without_terminating(service):
    service.register(URL)
    video = service.video("abcdefghijk")
    service.jobs.items[video["batch_job_id"]]["status"] = "FAILED"
    service.jobs.terminate = Mock()
    service.delete("abcdefghijk")
    service.jobs.terminate.assert_not_called()
    assert service.videos.get("abcdefghijk") is None


@pytest.mark.parametrize(
    ("setup", "code"),
    [
        (lambda s, v: s.jobs.items[v["batch_job_id"]].update(status="SUCCEEDED"), "backup_object"),
        (lambda s, v: s.jobs.items.pop(v["batch_job_id"]), "job_needs_reconciliation"),
        (lambda s, v: s.jobs.items[v["batch_job_id"]].update(status="WEIRD"), "job_needs"),
        (lambda s, v: s.videos.has_object.__setattr__("return_value", True), "backup_object"),
    ],
)
def test_cancel_is_refused_when_the_outcome_is_not_certain(service, setup, code):
    service.register(URL)
    video = service.video("abcdefghijk")
    service.videos.has_object = Mock(return_value=False)
    setup(service, video)
    service.jobs.terminate = Mock()
    with pytest.raises(DomainError, match=code):
        service.delete("abcdefghijk")
    assert service.videos.get("abcdefghijk") == video


@pytest.mark.parametrize(
    ("state", "code"),
    [
        ("submitting", "concurrent_change"),
        ("submission_unknown", "submission_needs_reconciliation"),
    ],
)
def test_cancel_is_refused_while_a_submission_is_unresolved(service, state, code):
    service.register(URL)
    video = service.video("abcdefghijk")
    service.videos.items["abcdefghijk"].pop("batch_job_id")
    service.videos.items["abcdefghijk"]["backup_state"] = state
    with pytest.raises(DomainError, match=code):
        service.delete("abcdefghijk")
    assert service.videos.get("abcdefghijk") is not None
    assert video["backup_attempt_id"]


def test_cancel_loses_to_a_concurrent_retry(service):
    service.register(URL)
    video = service.video("abcdefghijk")
    service.jobs.items[video["batch_job_id"]]["status"] = "FAILED"
    original = service.videos.has_object

    def retry_claims_meanwhile(item):
        service.start("abcdefghijk")
        return original(item)

    service.videos.has_object = retry_claims_meanwhile
    with pytest.raises(DomainError, match="concurrent_change"):
        service.delete("abcdefghijk")
    assert service.videos.get("abcdefghijk") is not None
