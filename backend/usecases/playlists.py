from usecases.models import YoutubePlaylist, YoutubePlaylistVideo, playlist_identity


class PlaylistService:
    """Reads a YouTube playlist from YouTube. Nothing is stored; POST /videos registers."""

    def __init__(self, source):
        # source.videos(playlist_id) -> (videos in playlist order, count of unavailable items)
        self.source = source

    def get(self, url: str) -> YoutubePlaylist:
        playlist_id = playlist_identity(url)
        videos, unavailable = self.source.videos(playlist_id)
        return YoutubePlaylist(
            playlist_id=playlist_id,
            videos=[YoutubePlaylistVideo.model_validate(video) for video in videos],
            unavailable_count=unavailable,
        )
