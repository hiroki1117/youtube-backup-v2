"""Build a standard wheel plus vendored dependencies into a review-only Lambda ZIP."""

import argparse
import base64
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HANDLERS = {
    "video": "api.app.video_handler",
    "backup": "api.app.backup_handler",
    "s3_complete": "events.handlers.s3_complete",
    "scrapbox_scan": "events.handlers.scrapbox_scan",
    "retry": "events.handlers.retry",
}


# Fixed wheel timestamps as well as final ZIP timestamps. Never use wall-clock time.
BUILD_EPOCH = "1577836800"  # 2020-01-01 UTC


def normalize_target(target: Path) -> None:
    """Remove pip's host-specific metadata and unused console entrypoints.

    Source identity belongs in the external release manifest, not local wheel URLs.
    Keep installed distribution metadata and RECORD consistent for runtime consumers.
    """
    removed = set()
    for path in target.glob("*.dist-info/direct_url.json"):
        removed.add(path.relative_to(target).as_posix())
        path.unlink()
    shutil.rmtree(target / "bin", ignore_errors=True)
    for record in target.glob("*.dist-info/RECORD"):
        with record.open(newline="") as source:
            rows = list(csv.reader(source))
        rows = [
            row
            for row in rows
            if row[0] not in removed and not row[0].startswith(("../../bin/", "bin/"))
        ]
        with record.open("w", newline="") as output:
            csv.writer(output, lineterminator="\n").writerows(sorted(rows))


def write_archive(target: Path, archive: Path) -> None:
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path in sorted(target.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                info = zipfile.ZipInfo(path.relative_to(target).as_posix(), (2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                output.writestr(info, path.read_bytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("function", choices=HANDLERS)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    expected_python = (root / ".python-version").read_text().strip()
    if ".".join(map(str, sys.version_info[:3])) != expected_python:
        raise RuntimeError(f"Build requires Python {expected_python} from backend/.python-version")
    wheels = root / "build/dist"
    shutil.rmtree(wheels, ignore_errors=True)
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(wheels), str(root)],
        env={**os.environ, "SOURCE_DATE_EPOCH": BUILD_EPOCH},
        check=True,
    )
    wheel = sorted(wheels.glob("youtube_backup_backend-*.whl"))[-1]
    target = root / "build/lambda" / args.function
    shutil.rmtree(target, ignore_errors=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-compile",
            "--only-binary=:all:",
            "--platform",
            "manylinux2014_x86_64",
            "--platform",
            "manylinux_2_28_x86_64",
            "--implementation",
            "cp",
            "--python-version",
            "3.14",
            "--abi",
            "cp314",
            "--target",
            str(target),
            "-r",
            str(root / "requirements.lock"),
            str(wheel),
        ],
        check=True,
    )
    normalize_target(target)
    # Validate handler imports solely from the extracted artifact, with AWS construction forbidden.
    module, handler = HANDLERS[args.function].rsplit(".", 1)
    probe = (
        "import importlib,boto3; "
        "boto3.Session=lambda *a,**k: (_ for _ in ()).throw(AssertionError('AWS at import')); "
        f"assert callable(getattr(importlib.import_module('{module}'),'{handler}'))"
    )
    subprocess.run(
        [
            sys.executable,
            "-S",
            "-c",
            "import sys; sys.dont_write_bytecode=True; sys.path.insert(0, sys.argv[1]); " + probe,
            str(target),
        ],
        cwd="/tmp",
        check=True,
    )
    archive = root / "build" / f"{args.function}.zip"
    write_archive(target, archive)
    digest = hashlib.sha256(archive.read_bytes()).digest()
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    dirty = bool(
        subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()
    )
    manifest = {
        "schema_version": 1,
        "function": args.function,
        "artifact": archive.name,
        "handler": HANDLERS[args.function],
        "runtime": "python3.14",
        "architecture": "x86_64",
        "source_revision": revision,
        "source_tree_dirty": dirty,
        "sha256": digest.hex(),
        "code_sha256": base64.b64encode(digest).decode(),
        "requirements_sha256": hashlib.sha256(
            (root / "requirements.lock").read_bytes()
        ).hexdigest(),
        "execution_mode": "validation",
    }
    manifest_path = archive.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    subprocess.run([sys.executable, str(root / "verify_lambda.py"), str(manifest_path)], check=True)
    print(f"Review candidate: {archive.name}; manifest: {manifest_path.name}; no AWS deployment")


if __name__ == "__main__":
    main()
