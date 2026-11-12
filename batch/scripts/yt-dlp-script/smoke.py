"""Offline image smoke test; never execute main.sh or extract a URL."""

import os
import re
import shlex
import subprocess
from pathlib import Path

import yt_dlp


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


script = Path(__file__).with_name("main.sh")
run("sh", "-n", str(script))
for command in ("yt-dlp", "aws", "deno"):
    run(command, "--version")
if os.environ["BATCH_SCRIPT"] == "yt-dlp-script":
    run("ffmpeg", "-version")
else:
    run("gzip", "--version")
assert "curl_cffi" in "\n".join(
    line
    for line in run(
        "yt-dlp", "--ignore-config", "--list-impersonate-targets"
    ).splitlines()
    if "unavailable" not in line
), "No usable curl_cffi impersonation target"

# Read the actual command, not a second hand-maintained copy of its options.
# Only the simple command shape used by main.sh is supported; fail closed on changes.
commands = []
for line in script.read_text().replace("\\\n", " ").splitlines():
    tokens = shlex.split(line, comments=True)
    if tokens and tokens[0] == "yt-dlp":
        commands.append(tokens[1:])
assert len(commands) == 1, "Expected exactly one standalone yt-dlp command"
values = {
    "URL": "https://example.invalid/video",
    "FILENAME": "smoke",
    "MAX_COMMENTS": "10000",
}
pattern = re.compile(r"\$\{([A-Z_]+)(?::-([^}]*))?\}|\$([A-Z_]+)")


def expand(match):
    key = match[1] or match[3]
    assert key in values, f"Unsupported variable: {key}"
    return match[2] if match[2] is not None else values[key]


args = [pattern.sub(expand, arg) for arg in commands[0]]
assert not any(
    "$" in arg or "`" in arg or arg in ("|", ";", "&&", "||", ">", "<") for arg in args
)
parsed = yt_dlp.parse_options(["--ignore-config", *args])
assert parsed.urls == [values["URL"]]
if os.environ["BATCH_SCRIPT"] == "youtube-comments":
    assert parsed.ydl_opts["skip_download"] is True
    assert parsed.ydl_opts["getcomments"] is True
    assert parsed.ydl_opts["writeinfojson"] is False
    assert parsed.ydl_opts["extractor_args"]["youtube"]["max_comments"] == [
        "10000",
        "all",
        "all",
        "all",
    ]
print("Offline CLI and main.sh option smoke tests passed")
