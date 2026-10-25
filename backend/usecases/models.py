import hashlib
from typing import Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, TypeAdapter, field_validator


class Video(BaseModel):
    model_config = ConfigDict(extra="allow")
    video_id: str
    video_url: str
    platform: str
    title: str
    backupdate: str
    s3fullpath: str
    upload_status: Literal["init", "complete"]
    request_timestamp: str


class RegisterVideo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        TypeAdapter(HttpUrl).validate_python(value)
        return value  # Preserve exact legacy URL hashing for non-YouTube IDs.


class UpdateVideo(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=1000)


class Backup(BaseModel):
    video_id: str
    state: str
    batch_job_id: str | None = None


class Registration(BaseModel):
    video: Video
    backup: Backup
    already_registered: bool


class ErrorResponse(BaseModel):
    detail: str


class PlaybackUrl(BaseModel):
    url: str
    expires_in: int


class DomainError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(code)


def source_identity(url: str) -> tuple[str, str, str]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise DomainError(422, "invalid_url")
    if host == "youtu.be" or host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        if host == "youtu.be":
            video_id = parsed.path.strip("/")
        elif parsed.path.startswith(("/shorts/", "/live/")):
            video_id = parsed.path.split("/")[2]
        else:
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        import re

        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise DomainError(422, "invalid_youtube_id")
        return video_id, "youtube", f"https://www.youtube.com/watch?v={video_id}"
    if host in {"twitter.com", "www.twitter.com", "x.com", "www.x.com"}:
        # Twitter / X registration is not supported (no metadata source).
        raise DomainError(422, "twitter_registration_not_migrated")
    return hashlib.sha256(url.encode()).hexdigest()[:15], host, url
