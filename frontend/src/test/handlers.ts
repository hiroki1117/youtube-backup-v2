import { http, HttpResponse } from "msw";
import { makeRawCommentBackup, makeRawVideo, type RawVideo } from "./factories";

// vitest.config.ts の test.env と一致させる（テスト用 placeholder）。
export const TEST_API_BASE = "https://api.test.invalid";

/**
 * 状態別の既定データセット（backupdate 違いで複数件）。
 * ソート（backupDate 昇順/降順）・ページング検証のため、意図的に日付を非整列で並べる。
 */
export const COMPLETE_RAW_VIDEOS: RawVideo[] = [
  makeRawVideo({
    video_id: "c1",
    title: "完了動画1",
    backupdate: "2026-08-01",
    platform: "youtube",
  }),
  makeRawVideo({
    video_id: "c2",
    title: "完了動画2",
    backupdate: "2026-08-03",
    platform: "twitter",
  }),
  makeRawVideo({
    video_id: "c3",
    title: "完了動画3",
    backupdate: "2026-08-02",
    platform: "youtube",
  }),
];

export const INIT_RAW_VIDEOS: RawVideo[] = [
  makeRawVideo({
    video_id: "i1",
    title: "処理中動画1",
    backupdate: "2026-07-20",
    upload_status: "init",
    platform: "youtube",
  }),
  makeRawVideo({
    video_id: "i2",
    title: "処理中動画2",
    backupdate: "2026-07-25",
    upload_status: "init",
    platform: "twitter",
  }),
];

/** POST /videos の応答形状（Registration）。 */
export interface RegistrationBody {
  video: RawVideo;
  backup: { video_id: string; state: string; batch_job_id: string | null };
  already_registered: boolean;
}

/**
 * POST /videos の成功応答を生成する（U4 登録テスト用）。
 * `already_registered` で新規登録（バックアップ開始）／既登録を切り替える。
 */
export function makeRegistration(
  overrides: Partial<{
    video_id: string;
    title: string;
    already_registered: boolean;
    batch_job_id: string | null;
  }> = {},
): RegistrationBody {
  const already = overrides.already_registered ?? false;
  const videoId = overrides.video_id ?? "new1";
  return {
    video: makeRawVideo({
      video_id: videoId,
      title: overrides.title ?? "新規登録動画",
      upload_status: already ? "complete" : "init",
    }),
    backup: {
      video_id: videoId,
      state: already ? "complete" : "submitted",
      batch_job_id: overrides.batch_job_id === undefined ? "job-new1" : overrides.batch_job_id,
    },
    already_registered: already,
  };
}

/**
 * エラー応答（新 API は HTTP ステータス + `{ detail: <コード> }`）。
 * 例: 404 video_not_found / 409 backup_object_needs_reconciliation / 422 invalid_url。
 */
export function errorResponse(status: number, detail: string): Response {
  return HttpResponse.json({ detail }, { status });
}

/** 認証切れ（API Gateway の JWT 検証失敗）。 */
export function unauthorizedResponse(): Response {
  return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });
}

/** テスト用の署名 URL（https。download.ts の https 検証・<video src> の再生ソースに使う）。 */
export const TEST_PRESIGNED_URL =
  "https://s3.ap-northeast-1.amazonaws.com/example-bucket/v1.mp4?sig=test";

/** GET /videos/{id}/playback_url の成功応答（有効期限 3600 秒）。 */
export function makePlaybackUrl(url: string = TEST_PRESIGNED_URL): {
  url: string;
  expires_in: number;
} {
  return { url, expires_in: 3600 };
}

/**
 * 既定ハンドラ（happy path）。`upload_status` クエリに応じて状態別配列を返す。
 * 個別の失敗系・空系・既登録・ページング件数は各テストで server.use() により上書きする。
 * ハンドラは unit / integration で共有し、実装詳細への結合を避ける。
 */
export const handlers = [
  http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
    const status = new URL(request.url).searchParams.get("upload_status");
    if (status === "init") {
      return HttpResponse.json(INIT_RAW_VIDEOS);
    }
    return HttpResponse.json(COMPLETE_RAW_VIDEOS);
  }),
  // POST /videos: 既定は新規登録成功（バックアップ開始 = 202）。既登録・URL異常・transport は各テストで上書き。
  http.post(`${TEST_API_BASE}/videos`, () =>
    HttpResponse.json(makeRegistration(), { status: 202 }),
  ),
  // GET /videos/{video_id}: 既定は complete 動画の取得成功。未存在・transport・init は各テストで上書き。
  http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.json(makeRawVideo())),
  // DELETE /videos/{video_id}: 既定は削除成功（204 本文なし）。
  http.delete(`${TEST_API_BASE}/videos/:videoId`, () => new HttpResponse(null, { status: 204 })),
  // DELETE /videos/{video_id}/backup: 既定はバックアップ取り消し成功（204 本文なし）。
  http.delete(
    `${TEST_API_BASE}/videos/:videoId/backup`,
    () => new HttpResponse(null, { status: 204 }),
  ),
  // GET /videos/{video_id}/playback_url: 既定は署名 URL 取得成功。
  http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () =>
    HttpResponse.json(makePlaybackUrl()),
  ),
  // GET /videos/{video_id}/comments: 既定は未取得。
  http.get(`${TEST_API_BASE}/videos/:videoId/comments`, () =>
    HttpResponse.json(makeRawCommentBackup()),
  ),
  // POST /videos/{video_id}/comments: 既定は取得開始（202）。取得中（200）・失敗は各テストで上書き。
  http.post(`${TEST_API_BASE}/videos/:videoId/comments`, () =>
    HttpResponse.json(
      makeRawCommentBackup({ state: "running", attempt_id: "a1", batch_job_id: "job-c1" }),
      { status: 202 },
    ),
  ),
];
