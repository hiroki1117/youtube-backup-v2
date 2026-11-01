import os
from functools import cached_property

import boto3
import httpx

from usecases.models import DomainError

ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems"
# Reasons the Data API gives for a playlist the API key cannot read (missing or private).
NOT_FOUND = {"playlistNotFound", "playlistItemsNotAccessible"}
# Private and deleted videos stay in a playlist with another privacy status and cannot be fetched.
AVAILABLE = {"public", "unlisted"}


class PlaylistRepository:
    """Reads a playlist with the YouTube Data API: 1 quota unit per page of 50 items."""

    def __init__(self, session=None):
        self.session = session or boto3.Session()

    @cached_property
    def ssm(self):
        return self.session.client("ssm")

    def videos(self, playlist_id: str) -> tuple[list[dict], int]:
        key = self.ssm.get_parameter(
            Name=os.environ["SSM_YOUTUBE_API_KEY_PARAMETER"], WithDecryption=True
        )["Parameter"]["Value"]
        params = {"part": "snippet,status", "playlistId": playlist_id, "maxResults": 50, "key": key}
        videos, seen, unavailable = [], set(), 0
        try:
            with httpx.Client(timeout=15) as client:
                while True:
                    response = client.get(ITEMS_URL, params=params)
                    if response.status_code in (403, 404) and reason(response) in NOT_FOUND:
                        raise DomainError(404, "playlist_not_found")
                    response.raise_for_status()
                    page = response.json()
                    for item in page["items"]:
                        if item.get("status", {}).get("privacyStatus") not in AVAILABLE:
                            unavailable += 1
                            continue
                        video_id = item["snippet"]["resourceId"]["videoId"]
                        if video_id in seen:
                            continue
                        seen.add(video_id)
                        videos.append(
                            {
                                "video_id": video_id,
                                "url": f"https://www.youtube.com/watch?v={video_id}",
                                "title": item["snippet"]["title"],
                            }
                        )
                    if not page.get("nextPageToken"):
                        return videos, unavailable
                    params["pageToken"] = page["nextPageToken"]
        except httpx.HTTPError, ValueError, KeyError, TypeError:
            # The request URL carries the API key: never let the httpx error reach the response.
            raise DomainError(502, "playlist_unavailable") from None


def reason(response: httpx.Response) -> str | None:
    try:
        return response.json()["error"]["errors"][0]["reason"]
    except ValueError, KeyError, IndexError, TypeError:
        return None
