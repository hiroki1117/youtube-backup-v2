import base64
import copy
import hashlib
import io
import json
from pathlib import Path

import boto3
import botocore.session
import pytest
from botocore import xform_name
from botocore.stub import Stubber

from build_lambda import HANDLERS
from deploy_lambda import DeploymentError, candidates, deploy, function_names

NAMES = {name: f"example-v2-{name}" for name in HANDLERS}
MODEL = botocore.session.get_session().get_waiter_model("lambda")
WAITERS = {xform_name(name): MODEL.get_waiter(name) for name in MODEL.waiter_names}


class FakeLambda:
    def __init__(self, artifacts):
        self.calls = []
        self.versions = {target: {} for target in NAMES.values()}
        self.configs = {
            NAMES[name]: {
                "State": "Active",
                "LastUpdateStatus": "Successful",
                "CodeSha256": "bootstrap",
                "RevisionId": "initial",
                "Version": "$LATEST",
                "Handler": manifest["handler"],
                "Runtime": "python3.14",
                "Architectures": ["x86_64"],
                "Environment": {"Variables": {"BACKEND_EXECUTION_MODE": "validation"}},
                "Role": "example-logging-role",
                "Timeout": 15,
                "MemorySize": 256,
            }
            for name, (manifest, _) in artifacts.items()
        }
        self.bad_checksum = False
        self.wrong_executed_version = False
        self.allow_application = False

    def get_waiter(self, name):
        # Check every waiter selected by real deployment flow against the installed SDK.
        assert WAITERS[name].operation == "GetFunctionConfiguration"
        client = self

        class Waiter:
            def wait(self, **args):
                client.calls.append((name, args))

        return Waiter()

    def get_function_configuration(self, FunctionName, Qualifier=None):
        self.calls.append(("get", FunctionName))
        config = self.versions[FunctionName][Qualifier] if Qualifier else self.configs[FunctionName]
        return copy.deepcopy(config)

    def update_function_code(self, **args):
        assert set(args) == {"FunctionName", "ZipFile", "Publish", "RevisionId"}
        assert args["Publish"] is False
        config = self.configs[args["FunctionName"]]
        assert args["RevisionId"] == config["RevisionId"]
        config["RevisionId"] = "updated"
        config["CodeSha256"] = (
            "incorrect"
            if self.bad_checksum
            else base64.b64encode(hashlib.sha256(args["ZipFile"]).digest()).decode()
        )
        self.calls.append(("update", args["FunctionName"]))

    def publish_version(self, FunctionName, CodeSha256, RevisionId):
        config = self.configs[FunctionName]
        assert config["CodeSha256"] == CodeSha256 and config["RevisionId"] == RevisionId
        version = str(len(self.versions[FunctionName]) + 1)
        self.versions[FunctionName][version] = {**copy.deepcopy(config), "Version": version}
        self.calls.append(("publish", FunctionName))
        return {"Version": version}

    def get_paginator(self, name):
        assert name == "list_versions_by_function"
        client = self

        class Paginator:
            def paginate(self, FunctionName):
                yield {
                    "Versions": [
                        client.configs[FunctionName],
                        *client.versions[FunctionName].values(),
                    ]
                }

        return Paginator()

    def invoke(self, **args):
        assert args["Qualifier"].isdigit() and args["InvocationType"] == "RequestResponse"
        target = args["FunctionName"]
        assert args["Qualifier"] in self.versions[target]
        event = json.loads(args["Payload"])
        self.calls.append(("invoke", target))
        result = {
            "StatusCode": 200,
            "ExecutedVersion": ("999" if self.wrong_executed_version else args["Qualifier"]),
        }
        if event:
            name = next(name for name, value in NAMES.items() if value == target)
            payload = {
                "status": "ok",
                "function": name,
                "execution_mode": "validation",
                "aws_access": False,
            }
        elif self.allow_application:
            payload = {"unexpected": "application accepted"}
        else:
            result["FunctionError"] = "Unhandled"
            payload = {
                "errorType": "RuntimeError",
                "errorMessage": "Application invocation is disabled in validation mode",
            }
        result["Payload"] = io.BytesIO(json.dumps(payload).encode())
        return result


@pytest.fixture
def artifacts():
    return {
        name: (
            {
                "function": name,
                "handler": handler,
                "runtime": "python3.14",
                "architecture": "x86_64",
                "code_sha256": base64.b64encode(hashlib.sha256(name.encode()).digest()).decode(),
            },
            name.encode(),
        )
        for name, handler in HANDLERS.items()
    }


def test_initial_release_updates_only_code_then_checks_all_five(artifacts):
    client = FakeLambda(artifacts)
    result = deploy(client, NAMES, artifacts, initial_validation=True)
    assert len(result) == 5 and all(r["version"] == "1" for r in result)
    assert len([c for c in client.calls if c[0] == "invoke"]) == 10
    first_write = next(i for i, c in enumerate(client.calls) if c[0] == "update")
    assert len([c for c in client.calls[:first_write] if c[0] == "get"]) == 5
    assert [c[1] for c in client.calls if c[0] == "update"] == list(NAMES.values())
    client.calls.clear()
    deploy(client, NAMES, artifacts)  # Same code/settings: reuse versions, no writes or invokes.
    assert not any(c[0] in {"update", "publish", "invoke"} for c in client.calls)


def test_infra_role_change_does_not_reuse_version_with_old_role(artifacts):
    client = FakeLambda(artifacts)
    deploy(client, NAMES, artifacts)
    for config in client.configs.values():
        config["Role"] = "example-new-logging-role"
    client.calls.clear()
    result = deploy(client, NAMES, artifacts)
    assert all(item["version"] == "2" for item in result)
    assert not any(c[0] == "update" for c in client.calls)


def test_all_targets_preflight_before_any_mutation(artifacts):
    client = FakeLambda(artifacts)
    client.configs[NAMES["retry"]]["Environment"]["Variables"]["BACKEND_EXECUTION_MODE"] = (
        "application"
    )
    with pytest.raises(DeploymentError, match="configuration"):
        deploy(client, NAMES, artifacts, initial_validation=True)
    assert not any(c[0] in {"update", "publish", "invoke"} for c in client.calls)


def test_wrong_uploaded_hash_stops_before_publish_or_invoke(artifacts):
    client = FakeLambda(artifacts)
    client.bad_checksum = True
    with pytest.raises(DeploymentError, match="CodeSha256 mismatch"):
        deploy(client, NAMES, artifacts, initial_validation=True)
    assert not any(c[0] in {"publish", "invoke"} for c in client.calls)


@pytest.mark.parametrize("fault", ["wrong_executed_version", "allow_application"])
def test_initial_invocation_result_must_match_contract(artifacts, fault):
    client = FakeLambda(artifacts)
    setattr(client, fault, True)
    with pytest.raises(DeploymentError):
        deploy(client, NAMES, artifacts, initial_validation=True)


@pytest.mark.parametrize(
    "value",
    [
        "{}",
        "[]",
        "null",
        json.dumps({**NAMES, "retry": NAMES["video"]}),
        json.dumps({**NAMES, "retry": "not/a/function"}),
    ],
)
def test_invalid_function_mapping_is_rejected(value):
    with pytest.raises(DeploymentError):
        function_names(value)


def test_candidates_reject_source_and_archive_mismatch(tmp_path, artifacts):
    revision = "a" * 40
    lock = hashlib.sha256(
        (Path(__file__).parents[1] / "requirements.lock").read_bytes()
    ).hexdigest()
    for name, (manifest, archive) in artifacts.items():
        (tmp_path / f"{name}.zip").write_bytes(archive)
        manifest.update(
            schema_version=1,
            artifact=f"{name}.zip",
            execution_mode="validation",
            source_tree_dirty=False,
            source_revision=revision,
            requirements_sha256=lock,
            sha256=hashlib.sha256(archive).hexdigest(),
        )
        (tmp_path / f"{name}.manifest.json").write_text(json.dumps(manifest))
    assert len(candidates(tmp_path, revision)) == 5
    with pytest.raises(DeploymentError, match="source revision"):
        candidates(tmp_path, "b" * 40)
    (tmp_path / "video.zip").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="SHA256"):
        candidates(tmp_path, revision)


@pytest.mark.parametrize(
    "name", ["function_active", "function_updated", "published_version_active"]
)
def test_sdk_waiters_only_call_permitted_configuration_api(name):
    client = boto3.client(
        "lambda",
        region_name="us-east-1",
        aws_access_key_id="example",
        aws_secret_access_key="example",
    )
    params = {"FunctionName": "example-v2-video"}
    if name == "published_version_active":
        params["Qualifier"] = "1"
    # Stubber rejects an unexpected GetFunction call; no HTTP/AWS access occurs.
    with Stubber(client) as stub:
        stub.add_response(
            "get_function_configuration",
            {"State": "Active", "LastUpdateStatus": "Successful"},
            params,
        )
        client.get_waiter(name).wait(**params, WaiterConfig={"Delay": 0, "MaxAttempts": 1})
        stub.assert_no_pending_responses()
