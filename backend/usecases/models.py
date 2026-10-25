import hashlib
import re
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


class CommentBackup(BaseModel):
    video_id: str
    platform: str
    # not_started | submitting | running | awaiting_ingest | complete | failed
    state: str
    attempt_id: str | None = None
    batch_job_id: str | None = None
    requested_at: int | None = None
    # Result of the last completed attempt; kept while a newer attempt runs.
    comment_count: int | None = None
    completed_at: int | None = None


class YoutubeComment(BaseModel):
    comment_id: str
    parent: str  # "root" or the parent comment ID
    text: str
    like_count: int
    author: str | None = None
    author_id: str | None = None
    author_is_uploader: bool = False
    is_pinned: bool = False
    posted_at: int | None = None
    # Missing from the latest completed fetch: deleted or hidden on YouTube since it was backed up.
    removed: bool = False


class YoutubeCommentThread(YoutubeComment):
    replies: list[YoutubeComment] = []


class YoutubeCommentPage(BaseModel):
    platform: Literal["youtube"] = "youtube"
    total_threads: int
    total_comments: int
    threads: list[YoutubeCommentThread]
    next_offset: int | None


class Registration(BaseModel):
    video: Video
    backup: Backup
    already_registered: bool


class YoutubePlaylistVideo(BaseModel):
    video_id: str
    url: str  # Normalized watch URL, accepted by POST /videos as is.
    title: str


class YoutubePlaylist(BaseModel):
    playlist_id: str
    videos: list[YoutubePlaylistVideo]  # In playlist order; a video listed twice appears once.
    # Items that cannot be backed up (private or deleted videos), left out of `videos`.
    unavailable_count: int


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


TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}
TIKTOK_SHORT_HOSTS = {"vm.tiktok.com", "vt.tiktok.com"}


def is_tiktok_short_link(url: str) -> bool:
    """A TikTok share link (vt./vm.tiktok.com/…, tiktok.com/t/…), which hides the video ID."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return host in TIKTOK_SHORT_HOSTS or (host in TIKTOK_HOSTS and parsed.path.startswith("/t/"))


def source_identity(url: str) -> tuple[str, str, str]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise DomainError(422, "invalid_url")
    if is_tiktok_short_link(url):
        # Registration resolves share links first (VideoRepository.resolve).
        raise DomainError(422, "tiktok_short_link_unresolved")
    if host in TIKTOK_HOSTS:
        match = re.fullmatch(r"/@([\w.-]+)/(video|photo)/(\d+)/?", parsed.path)
        if not match:
            raise DomainError(422, "invalid_tiktok_url")
        user, kind, video_id = match.groups()
        if kind == "photo":
            # Photo (slideshow) posts are not videos; yt-dlp cannot back them up reliably.
            raise DomainError(422, "unsupported_tiktok_post")
        return video_id, "tiktok", f"https://www.tiktok.com/@{user}/video/{video_id}"
    if host == "youtu.be" or host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        if host == "youtu.be":
            video_id = parsed.path.strip("/")
        elif parsed.path.startswith(("/shorts/", "/live/")):
            video_id = parsed.path.split("/")[2]
        else:
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise DomainError(422, "invalid_youtube_id")
        return video_id, "youtube", f"https://www.youtube.com/watch?v={video_id}"
    if host in {"twitter.com", "www.twitter.com", "x.com", "www.x.com"}:
        # Twitter / X registration is not supported (no metadata source).
        raise DomainError(422, "twitter_registration_not_migrated")
    return hashlib.sha256(url.encode()).hexdigest()[:15], host, url


YOUTUBE_HOSTS = {"youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
# Mixes (RD...) are generated per viewer; Watch later (WL) and Liked videos (LL) need the
# owner's sign-in, which an API key cannot provide.
UNSUPPORTED_PLAYLISTS = ("RD", "WL", "LL")


def playlist_identity(url: str) -> str:
    """The playlist ID in a YouTube URL's `list` parameter, also when the URL plays a video."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise DomainError(422, "invalid_url")
    playlist_id = parse_qs(parsed.query).get("list", [""])[0]
    if host not in YOUTUBE_HOSTS or not re.fullmatch(r"[A-Za-z0-9_-]+", playlist_id):
        raise DomainError(422, "not_a_youtube_playlist")
    if playlist_id.startswith(UNSUPPORTED_PLAYLISTS):
        raise DomainError(422, "unsupported_playlist")
    return playlist_id
