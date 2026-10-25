"""Build a standard wheel plus vendored dependencies into the Lambda ZIP.

All Lambdas share this ZIP; each one differs only in its configured handler.
"""

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HANDLERS = {
    "video": "entrypoints.video.handler",
    "backup": "entrypoints.backup.handler",
    "s3_complete": "entrypoints.s3_complete.handler",
    "scrapbox_scan": "entrypoints.scrapbox_scan.handler",
    "retry": "entrypoints.retry.handler",
}


def main():
    root = Path(__file__).resolve().parent
    wheels = root / "build/dist"
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(wheels), str(root)], check=True
    )
    wheel = sorted(wheels.glob("youtube_backup_backend-*.whl"))[-1]
    target = root / "build/lambda"
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
            str(root / "requirements.txt"),
            str(wheel),
        ],
        check=True,
    )
    # Validate every handler import solely from the extracted artifact, with AWS construction
    # forbidden. Each handler is imported in its own process to mirror one Lambda per cold start.
    for path in HANDLERS.values():
        module, handler = path.rsplit(".", 1)
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
                "import sys; sys.dont_write_bytecode=True; sys.path.insert(0, sys.argv[1]); "
                + probe,
                str(target),
            ],
            cwd="/tmp",
            check=True,
        )
    archive = root / "build/backend.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path in sorted(target.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                output.write(path, path.relative_to(target))
    print(f"Built {archive.name}; runtime: python3.14; x86_64")
    for name, path in HANDLERS.items():
        print(f"  {name:<14} handler: {path}")


if __name__ == "__main__":
    main()
