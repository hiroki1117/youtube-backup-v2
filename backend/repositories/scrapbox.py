import os
import re
from urllib.parse import quote

import boto3
import httpx

from usecases.models import DomainError

YOUTUBE_URL = re.compile(
    r"https://(?:www\.)?youtube\.com/(?:watch\?v=|shorts/|live/)[A-Za-z0-9_-]{11}"
    r"|https://youtu\.be/[A-Za-z0-9_-]{11}"
)


class ScrapboxRepository:
    def __init__(self, session=None):
        self.ssm = (session or boto3.Session()).client("ssm")

    def video_urls(self) -> list[str]:
        params = self.ssm.get_parameters(
            Names=[
                os.environ["SSM_SCRAPBOX_CREDENTIALS_PARAMETER"],
                os.environ["SSM_SCRAPBOX_PROJECTS_PARAMETER"],
            ],
            WithDecryption=True,
        )["Parameters"]
        values = {p["Name"]: p["Value"] for p in params}
        headers = {
            "Cookie": "connect.sid=" + values[os.environ["SSM_SCRAPBOX_CREDENTIALS_PARAMETER"]],
            "User-Agent": "youtube-backup-v2/0.1",
        }
        urls = set()
        try:
            with httpx.Client(headers=headers, timeout=15) as client:
                for project in values[os.environ["SSM_SCRAPBOX_PROJECTS_PARAMETER"]].split(","):
                    project = project.strip()
                    if not project:
                        continue
                    base = "https://scrapbox.io/api/pages/" + quote(project, safe="")
                    pages = client.get(base, params={"limit": 25})
                    pages.raise_for_status()
                    for page in pages.json()["pages"]:
                        content = client.get(base + "/" + quote(page["title"], safe=""))
                        content.raise_for_status()
                        for line in content.json()["lines"]:
                            urls.update(m.group() for m in YOUTUBE_URL.finditer(line["text"]))
        except httpx.HTTPError, KeyError, ValueError:
            raise DomainError(502, "scrapbox_unavailable") from None
        return sorted(urls)
