from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Response

from api.dependencies import get_comment_service, get_playlist_service, get_service
from usecases.backup import BackupService
from usecases.comments import CommentService
from usecases.models import (
    Backup,
    CommentBackup,
    ErrorResponse,
    PlaybackUrl,
    RegisterVideo,
    Registration,
    UpdateVideo,
    Video,
    YoutubeCommentPage,
    YoutubePlaylist,
)
from usecases.playlists import PlaylistService

errors = {status: {"model": ErrorResponse} for status in (401, 404, 409, 502, 503)}
video_router = APIRouter(tags=["videos"], responses=errors)
backup_router = APIRouter(tags=["backup"], responses=errors)
comment_router = APIRouter(tags=["comments"], responses=errors | {422: {"model": ErrorResponse}})
youtube_router = APIRouter(tags=["youtube"], responses=errors | {422: {"model": ErrorResponse}})
Service = Annotated[BackupService, Depends(get_service)]
Comments = Annotated[CommentService, Depends(get_comment_service)]
Playlists = Annotated[PlaylistService, Depends(get_playlist_service)]
VideoId = Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


@video_router.get("/videos", response_model=list[Video])
def list_videos(
    service: Service,
    upload_status: Literal["init", "complete"] = "complete",
    fetch_num: Annotated[int, Query(ge=1, le=1000)] = 30,
):
    return service.videos.list(upload_status, fetch_num)


@video_router.post("/videos", response_model=Registration, responses={202: {"model": Registration}})
def register_video(body: RegisterVideo, response: Response, service: Service):
    result, started = service.register(str(body.url))
    response.status_code = 202 if started else 200
    return result


@video_router.get("/videos/{video_id}", response_model=Video)
def get_video(video_id: VideoId, service: Service):
    return service.video(video_id)


@video_router.patch("/videos/{video_id}", response_model=Video)
def update_video(video_id: VideoId, body: UpdateVideo, service: Service):
    service.video(video_id)
    return service.videos.update_title(video_id, body.title)


@video_router.delete("/videos/{video_id}", status_code=204)
def delete_video(video_id: VideoId, service: Service):
    service.delete(video_id)


@video_router.get("/videos/{video_id}/playback_url", response_model=PlaybackUrl)
def playback_url(video_id: VideoId, response: Response, service: Service):
    response.headers["Cache-Control"] = "no-store"
    return PlaybackUrl(url=service.playback(video_id), expires_in=3600)


@backup_router.get("/videos/{video_id}/backup", response_model=Backup)
def get_backup(video_id: VideoId, service: Service):
    return service.backup(video_id)


@backup_router.post(
    "/videos/{video_id}/backup", response_model=Backup, responses={202: {"model": Backup}}
)
def start_backup(video_id: VideoId, response: Response, service: Service):
    result, started = service.start(video_id)
    response.status_code = 202 if started else 200
    return result


@backup_router.delete("/videos/{video_id}/backup", status_code=204)
def cancel_backup(video_id: VideoId, service: Service):
    """Cancel an unfinished backup: stops its job and removes the unfinished video record."""
    service.cancel(video_id)


@comment_router.get("/videos/{video_id}/comments/backup", response_model=CommentBackup)
def get_comment_backup(video_id: VideoId, comments: Comments):
    return comments.status(video_id)


@comment_router.post(
    "/videos/{video_id}/comments/backup",
    response_model=CommentBackup,
    responses={202: {"model": CommentBackup}},
)
def start_comment_backup(video_id: VideoId, response: Response, comments: Comments):
    """Fetch the video's comments (again); a fetch already in progress is not resubmitted."""
    result, started = comments.start(video_id)
    response.status_code = 202 if started else 200
    return result


@comment_router.get("/videos/{video_id}/comments", response_model=YoutubeCommentPage)
def list_comments(
    video_id: VideoId,
    comments: Comments,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """Backed-up comments as threads (pinned first, then newest). The shape is per platform."""
    return comments.items(video_id, offset, limit)


@youtube_router.get("/youtube/playlist", response_model=YoutubePlaylist)
def get_youtube_playlist(
    url: Annotated[str, Query(min_length=1, max_length=2048)], playlists: Playlists
):
    """The playlist in a YouTube URL (`list`), read from YouTube as is: its videos in order.

    Nothing is stored or registered; register the videos with POST /videos."""
    return playlists.get(url)
