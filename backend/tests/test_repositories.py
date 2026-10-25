import hashlib
from unittest.mock import Mock

import boto3
import httpx
import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from repositories.jobs import JobRepository
from repositories.scrapbox import ScrapboxRepository
from repositories.videos import VideoRepository, source_identity
from usecases.models import DomainError, RegisterVideo


def test_existing_id_formats_and_exact_generic_url_hash():
    assert source_identity("https://youtu.be/-abcdefghij")[0] == "-abcdefghij"
    assert source_identity("https://youtube.com/live/abcdefghijk")[0] == "abcdefghijk"
    url = "https://example.invalid"
    assert RegisterVideo(url=url).url == url
    assert source_identity(url)[0] == hashlib.sha256(url.encode()).hexdigest()[:15]
    with pytest.raises(DomainError):
        source_identity("https://user:password@example.invalid/file")


def make_repo(table):
    repo = object.__new__(VideoRepository)
    repo.table = table
    repo.s3 = Mock()
    return repo


def condition_failed():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


def test_dynamo_guards_no_upsert_or_stale_completion(service):
    service.register("https://youtu.be/abcdefghijk")
    video = service.video("abcdefghijk")
    table = Mock()
    repo = make_repo(table)
    table.update_item.return_value = {"Attributes": video}
    repo.claim(video, "new-attempt", "s3://example-bucket/new-path", 1)
    args = table.update_item.call_args.kwargs
    assert "attribute_exists(video_id)" in args["ConditionExpression"]
    assert "upload_status=:init" in args["ConditionExpression"]
    assert "backup_attempt_id = :expected" in args["ConditionExpression"]
    assert args["ExpressionAttributeValues"][":expected"] == video["backup_attempt_id"]
    table.update_item.side_effect = condition_failed()
    assert repo.complete(video, video["s3fullpath"] + ".mp4") is False
    assert "s3fullpath=:expected" in table.update_item.call_args.kwargs["ConditionExpression"]
    with pytest.raises(DomainError, match="video_not_found"):
        repo.update_title("missing", "title")
    assert "attribute_exists(video_id)" in table.update_item.call_args.kwargs["ConditionExpression"]


def test_delete_lock_precedes_s3_and_is_preserved_on_failure(service):
    service.register("https://youtu.be/abcdefghijk")
    video = service.video("abcdefghijk")
    video["upload_status"] = "complete"
    video["s3fullpath"] += ".mp4"
    table = Mock()
    repo = make_repo(table)
    order = Mock()
    order.attach_mock(table, "table")
    order.attach_mock(repo.s3, "s3")
    repo.delete(video, "test-deletion-token")
    assert [call[0] for call in order.mock_calls] == [
        "table.update_item",
        "s3.delete_object",
        "table.delete_item",
    ]
    assert "deletion_token=:token" in table.delete_item.call_args.kwargs["ConditionExpression"]
    assert "upload_status=:complete" in table.update_item.call_args.kwargs["ConditionExpression"]
    table.reset_mock()
    repo.s3.delete_object.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied"}}, "DeleteObject"
    )
    with pytest.raises(ClientError):
        repo.delete(video, "test-deletion-token")
    table.delete_item.assert_not_called()


def test_batch_and_ssm_contract_no_resubmission_retries(monkeypatch):
    for key, value in {
        "JOB_QUEUE_NAME": "example-queue",
        "YTDLP_JOB_DEFINITION_NAME": "example-definition",
        "YTDLP_JOB_REVISION": "1",
        "SSM_PROXY_PATH_PARAMETER": "/example/proxy",
        "SSM_COOKIE_S3_PATH_PARAMETER": "/example/cookie",
    }.items():
        monkeypatch.setenv(key, value)
    session = boto3.Session(
        aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1"
    )
    repo = JobRepository(session)
    assert repo.batch.meta.config.retries["total_max_attempts"] == 1
    ssm = Stubber(repo.ssm)
    batch = Stubber(repo.batch)
    ssm.add_response(
        "get_parameters",
        {"Parameters": []},
        {
            "Names": ["/example/proxy", "/example/cookie"],
            "WithDecryption": True,
        },
    )
    batch.add_response(
        "submit_job",
        {"jobName": "youtube-backup-attempt", "jobId": "example-job"},
        {
            "jobName": "youtube-backup-attempt",
            "jobQueue": "example-queue",
            "jobDefinition": "example-definition:1",
            "containerOverrides": {
                "environment": [
                    {"name": "URL", "value": "https://example.invalid/video"},
                    {"name": "FILENAME", "value": "video"},
                    {"name": "S3PATH", "value": "s3://example-bucket/path/"},
                    {"name": "PROXY_PATH", "value": ""},
                    {"name": "COOKIE_S3_PATH", "value": ""},
                ]
            },
        },
    )
    batch.add_response("describe_jobs", {"jobs": []}, {"jobs": ["example-job"]})
    with ssm, batch:
        assert (
            repo.submit(
                {
                    "video_url": "https://example.invalid/video",
                    "s3fullpath": "s3://example-bucket/path/video",
                },
                "attempt",
            )
            == "example-job"
        )
        assert repo.get("example-job") is None
        ssm.assert_no_pending_responses()
        batch.assert_no_pending_responses()


def test_scrapbox_user_agent_dedup_and_failure(monkeypatch):
    monkeypatch.setenv("SSM_SCRAPBOX_CREDENTIALS_PARAMETER", "/example/credential")
    monkeypatch.setenv("SSM_SCRAPBOX_PROJECTS_PARAMETER", "/example/projects")
    repo = object.__new__(ScrapboxRepository)
    repo.ssm = Mock()
    repo.ssm.get_parameters.return_value = {
        "Parameters": [
            {"Name": "/example/credential", "Value": "dummy-cookie"},
            {"Name": "/example/projects", "Value": "example-project"},
        ]
    }
    real_client = httpx.Client
    seen = []

    def respond(request):
        seen.append(request)
        assert request.headers["user-agent"] == "youtube-backup-v2/0.1"
        if request.url.path.endswith("example-project"):
            return httpx.Response(200, json={"pages": [{"title": "example page"}]})
        return httpx.Response(
            200,
            json={"lines": [{"text": "https://youtu.be/abcdefghijk https://youtu.be/abcdefghijk"}]},
        )

    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(
        "repositories.scrapbox.httpx.Client",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    assert repo.video_urls() == ["https://youtu.be/abcdefghijk"]
    assert len(seen) == 2
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with pytest.raises(DomainError, match="scrapbox_unavailable"):
        repo.video_urls()


def test_youtube_metadata_and_sanitized_failure(monkeypatch):
    monkeypatch.setenv("SSM_YOUTUBE_API_KEY_PARAMETER", "/example/youtube-key")
    monkeypatch.setenv("BACKUP_BACKET", "example-video-bucket")
    repo = make_repo(Mock())
    repo.ssm = Mock()
    repo.ssm.get_parameter.return_value = {"Parameter": {"Value": "dummy-key"}}
    real_client = httpx.Client
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"items": [{"snippet": {"title": "Example video"}}]}
        )
    )
    monkeypatch.setattr(
        "repositories.videos.httpx.Client",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    video = repo.make_video("https://youtu.be/abcdefghijk", 1791763200)
    assert video["video_id"] == "abcdefghijk"
    assert video["title"] == "Example video"
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with pytest.raises(DomainError, match="metadata_unavailable") as error:
        repo.make_video("https://youtu.be/abcdefghijk", 1791763200)
    assert "dummy-key" not in str(error.value)


def test_cancel_deletes_only_the_inspected_unfinished_attempt(service):
    service.register("https://youtu.be/abcdefghijk")
    video = service.video("abcdefghijk")
    table = Mock()
    repo = make_repo(table)
    repo.cancel(video)
    args = table.delete_item.call_args.kwargs
    for part in ("upload_status=:init", "s3fullpath=:path", "attribute_not_exists(deletion_token)"):
        assert part in args["ConditionExpression"]
    assert args["ExpressionAttributeValues"][":path"] == video["s3fullpath"]
    table.delete_item.side_effect = condition_failed()
    with pytest.raises(DomainError, match="concurrent_change"):
        repo.cancel(video)


def test_has_object_looks_for_any_extension_under_the_key(service):
    service.register("https://youtu.be/abcdefghijk")
    video = service.video("abcdefghijk")
    repo = make_repo(Mock())
    repo.s3.list_objects_v2.return_value = {"KeyCount": 1}
    assert repo.has_object(video) is True
    kwargs = repo.s3.list_objects_v2.call_args.kwargs
    assert kwargs["Prefix"] == video["s3fullpath"].split("/", 3)[3]
    repo.s3.list_objects_v2.return_value = {"KeyCount": 0}
    assert repo.has_object(video) is False


def test_terminate_sends_one_unretried_request():
    repo = JobRepository(
        boto3.Session(
            aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1"
        )
    )
    batch = Stubber(repo.batch)
    batch.add_response("terminate_job", {}, {"jobId": "job-1", "reason": "Cancelled by the user"})
    with batch:
        repo.terminate("job-1", "Cancelled by the user")
        batch.assert_no_pending_responses()
