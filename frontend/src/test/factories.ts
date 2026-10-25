import type { Video } from "@/types/video";

/** API の生レスポンス形状（DynamoDB item, スネークケース）。 */
export interface RawVideo {
  video_id: string;
  video_url: string;
  platform: string;
  title: string;
  backupdate: string;
  s3fullpath: string;
  upload_status: "init" | "complete";
  request_timestamp: string;
}

/** 有効な生 Video（API 応答）を生成する。 */
export function makeRawVideo(overrides: Partial<RawVideo> = {}): RawVideo {
  return {
    video_id: "v1",
    video_url: "https://www.youtube.com/watch?v=abc123",
    platform: "youtube",
    title: "サンプル動画",
    backupdate: "2026-08-01",
    s3fullpath: "s3://example-bucket/v1.mp4",
    upload_status: "complete",
    request_timestamp: "1690000000",
    ...overrides,
  };
}

/** 検証済みドメイン型 Video を生成する。 */
export function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    videoId: "v1",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    platform: "youtube",
    title: "サンプル動画",
    backupDate: "2026-08-01",
    s3FullPath: "s3://example-bucket/v1.mp4",
    uploadStatus: "complete",
    requestTimestamp: "1690000000",
    ...overrides,
  };
}

/**
 * 複数の検証済み Video を生成する（U2 の sort/paginate テスト用）。
 * spec ごとに videoId を採番し、backupDate 等を差し替える。
 */
export function makeVideos(specs: Array<Partial<Video>>): Video[] {
  return specs.map((spec, index) => makeVideo({ videoId: `v${index + 1}`, ...spec }));
}

/**
 * 指定件数の生 Video を採番して生成する（クライアントサイドページングの件数テスト用）。
 * backupDate は連番日付（YYYY-MM-DD）で降順検証がしやすいようにずらす。
 */
export function makeRawVideos(count: number, overrides: Partial<RawVideo> = {}): RawVideo[] {
  return Array.from({ length: count }, (_unused, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    return makeRawVideo({
      video_id: `v${index + 1}`,
      title: `動画${index + 1}`,
      backupdate: `2026-08-${day}`,
      ...overrides,
    });
  });
}

/** API の生レスポンス形状（CommentBackup, スネークケース）。 */
export interface RawCommentBackup {
  video_id: string;
  platform: string;
  state: "not_started" | "submitting" | "running" | "awaiting_ingest" | "complete" | "failed";
  attempt_id?: string | null;
  batch_job_id?: string | null;
  requested_at?: number | null;
  comment_count?: number | null;
  completed_at?: number | null;
}

/** 有効な生 CommentBackup（API 応答）を生成する。既定は未取得。 */
export function makeRawCommentBackup(overrides: Partial<RawCommentBackup> = {}): RawCommentBackup {
  return { video_id: "v1", platform: "youtube", state: "not_started", ...overrides };
}

/** API の生レスポンス形状（YouTube コメント 1 件）。 */
export interface RawYoutubeComment {
  comment_id: string;
  parent: string;
  text: string;
  like_count: number;
  author: string | null;
  author_id: string | null;
  author_is_uploader: boolean;
  is_pinned: boolean;
  posted_at: number | null;
  removed: boolean;
}

/** 有効な生 YouTube コメントを生成する。 */
export function makeRawYoutubeComment(
  overrides: Partial<RawYoutubeComment> = {},
): RawYoutubeComment {
  return {
    comment_id: "Ugx1",
    parent: "root",
    text: "いい動画でした",
    like_count: 3,
    author: "@viewer",
    author_id: "UC1",
    author_is_uploader: false,
    is_pinned: false,
    posted_at: 1792713600,
    removed: false,
    ...overrides,
  };
}

/** GET /videos/{id}/comments の生レスポンス。既定はコメントなし。 */
export function makeRawYoutubeCommentPage(
  threads: (RawYoutubeComment & { replies: RawYoutubeComment[] })[] = [],
  nextOffset: number | null = null,
) {
  const total = threads.reduce((n, t) => n + 1 + t.replies.length, 0);
  return {
    platform: "youtube" as const,
    total_threads: threads.length,
    total_comments: total,
    threads,
    next_offset: nextOffset,
  };
}

export interface RawYoutubePlaylistVideo {
  video_id: string;
  url: string;
  title: string;
}

/** GET /youtube/playlist の生レスポンス。既定は 3 本・取得できない動画 1 本。 */
export function makeRawYoutubePlaylist(
  videos: RawYoutubePlaylistVideo[] = [
    makeRawYoutubePlaylistVideo("pv1", "再生リストの動画1"),
    makeRawYoutubePlaylistVideo("pv2", "再生リストの動画2"),
    makeRawYoutubePlaylistVideo("pv3", "再生リストの動画3"),
  ],
  unavailableCount = 1,
) {
  return { playlist_id: "PLtest", videos, unavailable_count: unavailableCount };
}

export function makeRawYoutubePlaylistVideo(
  videoId: string,
  title: string,
): RawYoutubePlaylistVideo {
  return { video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title };
}
