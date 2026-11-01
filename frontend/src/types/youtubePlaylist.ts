import { z } from "zod";

/**
 * YouTube の再生リスト（`GET /youtube/playlist?url=`）。YouTube からその場で読んだ中身で、保存はされない。
 * API 境界では zod で parse した値のみ扱う。
 */

export interface YoutubePlaylistVideo {
  videoId: string;
  /** `POST /videos` にそのまま渡せる watch URL。 */
  url: string;
  title: string;
}

export interface YoutubePlaylist {
  playlistId: string;
  /** 再生リストの並び順。同じ動画は 1 回だけ。 */
  videos: YoutubePlaylistVideo[];
  /** 非公開・削除済みで登録できない動画の数（`videos` には含まれない）。 */
  unavailableCount: number;
}

const rawPlaylistSchema = z.object({
  playlist_id: z.string(),
  videos: z.array(z.object({ video_id: z.string(), url: z.string(), title: z.string() })),
  unavailable_count: z.number(),
});

/** API 応答を YoutubePlaylist に変換する。形が違えば null。 */
export function parseYoutubePlaylist(raw: unknown): YoutubePlaylist | null {
  const parsed = rawPlaylistSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return {
    playlistId: parsed.data.playlist_id,
    videos: parsed.data.videos.map((video) => ({
      videoId: video.video_id,
      url: video.url,
      title: video.title,
    })),
    unavailableCount: parsed.data.unavailable_count,
  };
}
