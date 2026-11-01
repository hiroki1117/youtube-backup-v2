import { z } from "zod";

/** `GET /youtube/playlist` の応答。YouTube からその場で読んだ中身で、保存はされない。 */
export const youtubePlaylistSchema = z
  .object({
    playlist_id: z.string(),
    videos: z.array(z.object({ video_id: z.string(), url: z.string(), title: z.string() })),
    unavailable_count: z.number(),
  })
  .transform((raw) => ({
    playlistId: raw.playlist_id,
    /** 再生リストの並び順。同じ動画は 1 回だけ。`url` は `POST /videos` にそのまま渡せる。 */
    videos: raw.videos.map(({ video_id, url, title }) => ({ videoId: video_id, url, title })),
    /** 非公開・削除済みで登録できない動画の数（`videos` には含まれない）。 */
    unavailableCount: raw.unavailable_count,
  }));

export type YoutubePlaylist = z.output<typeof youtubePlaylistSchema>;
export type YoutubePlaylistVideo = YoutubePlaylist["videos"][number];
