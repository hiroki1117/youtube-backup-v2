"""Verify a release candidate's hash and isolated handler behavior. No AWS access."""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from build_lambda import HANDLERS


def read_manifest(manifest_path: Path, *, require_clean: bool = False) -> dict:
    manifest = json.loads(manifest_path.read_text())
    if require_clean and manifest["source_tree_dirty"] is not False:
        raise ValueError("Release candidate has uncommitted source changes")
    function = manifest["function"]
    if (
        manifest["schema_version"] != 1
        or manifest["handler"] != HANDLERS[function]
        or manifest["runtime"] != "python3.14"
        or manifest["architecture"] != "x86_64"
        or manifest["execution_mode"] != "validation"
        or manifest["artifact"] != f"{function}.zip"
    ):
        raise ValueError("Unexpected Lambda artifact contract")
    archive = manifest_path.parent / manifest["artifact"]
    digest = hashlib.sha256(archive.read_bytes()).digest()
    if (
        manifest["sha256"] != digest.hex()
        or manifest["code_sha256"] != base64.b64encode(digest).decode()
    ):
        raise ValueError("Artifact SHA256 mismatch")
    return manifest


def verify(manifest_path: Path, *, require_clean: bool = False):
    manifest = read_manifest(manifest_path, require_clean=require_clean)
    function = manifest["function"]
    archive = manifest_path.parent / manifest["artifact"]
    module, handler = manifest["handler"].rsplit(".", 1)
    probe = f"""
import importlib, json, socket, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import boto3

def forbidden(*args, **kwargs):
    raise AssertionError('AWS/network access forbidden during deployment check')
boto3.Session = boto3.client = boto3.resource = forbidden
class LocalSocketOnly(socket.socket):
    def __init__(self, family=socket.AF_INET, *args, **kwargs):
        if family in (socket.AF_INET, socket.AF_INET6):
            forbidden()
        super().__init__(family, *args, **kwargs)
socket.socket = LocalSocketOnly
socket.create_connection = socket.getaddrinfo = forbidden
handler = getattr(importlib.import_module({module!r}), {handler!r})
expected = {{'status': 'ok', 'function': {function!r},
            'execution_mode': 'validation', 'aws_access': False}}
assert handler({{'operation': 'deployment_check'}}, None) == expected
for event in ({{}}, {{'Records': []}}, {{'operation': 'deployment_check', 'mode': 'application'}}):
    try:
        handler(event, None)
    except RuntimeError as error:
        assert 'disabled' in str(error)
    else:
        raise AssertionError('Validation mode accepted application event')
print(json.dumps(expected))
"""
    with tempfile.TemporaryDirectory(prefix="lambda-verify-") as directory:
        with zipfile.ZipFile(archive) as contents:
            for name in contents.namelist():
                if Path(name).is_absolute() or ".." in Path(name).parts:
                    raise ValueError("Unsafe ZIP member")
            contents.extractall(directory)
        subprocess.run(
            [sys.executable, "-S", "-c", probe, directory],
            cwd=directory,
            env={**os.environ, "BACKEND_EXECUTION_MODE": "validation"},
            check=True,
        )
    print(f"Verified {function}: SHA256, packaged imports, smoke response, application rejection")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--require-clean", action="store_true")
    args = parser.parse_args()
    verify(args.manifest, require_clean=args.require_clean)
