import { z } from "zod";

export interface YoutubePlaylistVideo {
  videoId: string;
  /** `POST /videos` にそのまま渡せる watch URL。 */
  url: string;
  title: string;
}

/** `GET /youtube/playlist` の応答。YouTube からその場で読んだ中身で、保存はされない。 */
export interface YoutubePlaylist {
  playlistId: string;
  /** 再生リストの並び順。同じ動画は 1 回だけ。 */
  videos: YoutubePlaylistVideo[];
  /** 非公開・削除済みで登録できない動画の数（`videos` には含まれない）。 */
  unavailableCount: number;
}

export const youtubePlaylistSchema = z
  .object({
    playlist_id: z.string(),
    videos: z.array(z.object({ video_id: z.string(), url: z.string(), title: z.string() })),
    unavailable_count: z.number(),
  })
  .transform((raw): YoutubePlaylist => ({
    playlistId: raw.playlist_id,
    videos: raw.videos.map(({ video_id, url, title }) => ({ videoId: video_id, url, title })),
    unavailableCount: raw.unavailable_count,
  }));
