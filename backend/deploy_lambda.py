"""Deploy reviewed v2 ZIPs only. Infrastructure owns all function configuration."""

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from api.deployment import CHECK_EVENT
from build_lambda import HANDLERS
from verify_lambda import read_manifest

WAIT = {"Delay": 2, "MaxAttempts": 90}
# A reused immutable version must carry the current infra-managed settings too.
SETTINGS = (
    "Handler",
    "Runtime",
    "Architectures",
    "Environment",
    "Layers",
    "Role",
    "MemorySize",
    "Timeout",
    "VpcConfig",
    "DeadLetterConfig",
    "KMSKeyArn",
    "TracingConfig",
    "FileSystemConfigs",
    "EphemeralStorage",
    "SnapStart",
    "LoggingConfig",
)


class DeploymentError(Exception):
    pass


def function_names(value: str) -> dict:
    names = json.loads(value)
    if (
        not isinstance(names, dict)
        or set(names) != set(HANDLERS)
        or any(
            not isinstance(n, str) or not re.fullmatch(r"[\w-]{1,64}", n, re.ASCII)
            for n in names.values()
        )
        or len(set(names.values())) != len(HANDLERS)
    ):
        raise DeploymentError("LAMBDA_FUNCTION_NAMES must map exactly five keys to distinct names")
    return names


def candidates(directory: Path, revision: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise DeploymentError("A full source commit SHA is required")
    lock_hash = hashlib.sha256(
        (Path(__file__).parent / "requirements.lock").read_bytes()
    ).hexdigest()
    result = {}
    for name in HANDLERS:
        manifest = read_manifest(directory / f"{name}.manifest.json", require_clean=True)
        if (
            manifest["function"] != name
            or manifest["source_revision"] != revision
            or manifest["requirements_sha256"] != lock_hash
        ):
            raise DeploymentError(f"{name}: source revision or runtime lock mismatch")
        result[name] = (manifest, (directory / manifest["artifact"]).read_bytes())
    return result


def check_configuration(config: dict, manifest: dict) -> None:
    if (
        config.get("State") != "Active"
        or config.get("LastUpdateStatus", "Successful") != "Successful"
        or config.get("Handler") != manifest["handler"]
        or config.get("Runtime") != manifest["runtime"]
        or config.get("Architectures") != [manifest["architecture"]]
        or config.get("Layers")
        or config.get("Environment", {}).get("Variables")
        != {"BACKEND_EXECUTION_MODE": "validation"}
    ):
        raise DeploymentError("Function configuration must match the isolated validation contract")


def smoke_check(client, target: str, version: str, name: str) -> None:
    # Exactly two synchronous invocations; SDK automatic retries are disabled by main().
    for event in (CHECK_EVENT, {}):
        response = client.invoke(
            FunctionName=target,
            Qualifier=version,
            InvocationType="RequestResponse",
            Payload=json.dumps(event).encode(),
        )
        with response["Payload"] as payload:
            body = json.load(payload)
        if (
            not isinstance(body, dict)
            or response.get("StatusCode") != 200
            or response.get("ExecutedVersion") != version
        ):
            raise DeploymentError(f"{name}: invocation status/version mismatch")
        if event == CHECK_EVENT:
            expected = {
                "status": "ok",
                "function": name,
                "execution_mode": "validation",
                "aws_access": False,
            }
            if response.get("FunctionError") or body != expected:
                raise DeploymentError(f"{name}: application deployment check failed")
        elif (
            response.get("FunctionError") != "Unhandled"
            or body.get("errorType") != "RuntimeError"
            or body.get("errorMessage") != "Application invocation is disabled in validation mode"
        ):
            raise DeploymentError(f"{name}: application event was not rejected as expected")


def deploy(client, names: dict, artifacts: dict, *, initial_validation: bool = False) -> list:
    # Check every target before the first write. No configuration/role/alias/trigger updates.
    snapshots = {}
    for name, target in names.items():
        client.get_waiter("function_active_v2").wait(FunctionName=target, WaiterConfig=WAIT)
        config = client.get_function_configuration(FunctionName=target)
        check_configuration(config, artifacts[name][0])
        snapshots[name] = config
    results = []
    for name in HANDLERS:
        target = names[name]
        manifest, archive = artifacts[name]
        current = snapshots[name]
        digest = manifest["code_sha256"]
        version = None
        if current["CodeSha256"] == digest:
            versions = []
            for page in client.get_paginator("list_versions_by_function").paginate(
                FunctionName=target
            ):
                versions.extend(
                    item["Version"]
                    for item in page["Versions"]
                    if item["Version"].isdigit() and item.get("CodeSha256") == digest
                )
            for candidate in sorted(versions, key=int, reverse=True):
                published = client.get_function_configuration(
                    FunctionName=target, Qualifier=candidate
                )
                if all(published.get(key) == current.get(key) for key in SETTINGS):
                    check_configuration(published, manifest)
                    version = candidate
                    break
        else:
            client.update_function_code(
                FunctionName=target,
                ZipFile=archive,
                Publish=False,
                RevisionId=current["RevisionId"],
            )
            client.get_waiter("function_updated_v2").wait(FunctionName=target, WaiterConfig=WAIT)
            current = client.get_function_configuration(FunctionName=target)
        check_configuration(current, manifest)
        if current["CodeSha256"] != digest:
            raise DeploymentError(f"{name}: uploaded CodeSha256 mismatch")
        if version is None:
            published = client.publish_version(
                FunctionName=target,
                CodeSha256=digest,
                RevisionId=current["RevisionId"],
            )
            version = published["Version"]
        if not version.isdigit() or int(version) < 1:
            raise DeploymentError(f"{name}: a published numeric version is required")
        client.get_waiter("function_active_v2").wait(
            FunctionName=target,
            Qualifier=version,
            WaiterConfig=WAIT,
        )
        published = client.get_function_configuration(FunctionName=target, Qualifier=version)
        check_configuration(published, manifest)
        if published["CodeSha256"] != digest:
            raise DeploymentError(f"{name}: published CodeSha256 mismatch")
        print(f"{name}: published version {version} verified", file=sys.stderr)
        if initial_validation:
            smoke_check(client, target, version, name)
            print(f"{name}: initial validation passed", file=sys.stderr)
        results.append(
            {
                "function": name,
                "version": version,
                "code_sha256": digest,
                "initial_validation": initial_validation,
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--build-dir", type=Path, default=Path(__file__).parent / "build")
    parser.add_argument("--initial-validation", action="store_true")
    args = parser.parse_args()
    names = function_names(os.environ.get("LAMBDA_FUNCTION_NAMES", "{}"))
    artifacts = candidates(args.build_dir, args.source_revision)
    client = boto3.client(
        "lambda",
        config=Config(
            retries={"total_max_attempts": 1},
            connect_timeout=5,
            read_timeout=60,
        ),
    )
    print(json.dumps(deploy(client, names, artifacts, initial_validation=args.initial_validation)))


if __name__ == "__main__":
    try:
        main()
    except ClientError as error:
        raise SystemExit(f"Lambda deployment stopped: {error.response['Error']['Code']}") from None
    except BotoCoreError as error:
        raise SystemExit(f"Lambda deployment stopped: {type(error).__name__}") from None
    except DeploymentError, ValueError, KeyError, OSError:
        raise SystemExit(
            "Lambda deployment stopped: check target settings, manifest and artifacts"
        ) from None
