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
