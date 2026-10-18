import { delay, http, HttpResponse, type HttpHandler } from "msw";
import type { RawVideo } from "@/test/factories";
import { TEST_API_BASE, handlers, errorResponse, makePlaybackUrl } from "@/test/handlers";
import type { UploadStatus } from "@/types/video";

/**
 * Storybook 用の MSW シナリオハンドラ（US-3 / US-5 / OQ1）。
 * 既定ハンドラ（`src/test/handlers.ts`）と応答生成関数・factories を再利用し、
 * Story ごとの差分（空・エラー・保留）を `parameters.msw.handlers` で与えるための生成関数群。
 * base URL は `TEST_API_BASE`（`.storybook/main.ts` の `define` で `VITE_API_BASE_URL` に固定した値と一致）。
 * 実エンドポイント・実データ・認証情報は書かない（合成モックデータのみ）。
 */

type ScenarioMethod = "get" | "post" | "delete";

/**
 * Storybook 専用の署名 URL。`.invalid` TLD（RFC 2606）は DNS 解決されないため、`<video src>` や
 * `<a download>` が参照しても実ネットワーク（S3）へ到達しない。テスト用 `TEST_PRESIGNED_URL`
 * （amazonaws.com ドメインの合成値）は Storybook の初期ハンドラで本値に置き換える。
 */
export const STORYBOOK_PRESIGNED_URL = "https://media.test.invalid/videos/v1.mp4?sig=storybook";

/** GET /videos/{id}/playback_url を Storybook 専用の署名 URL で成功させる（初期ハンドラの先頭で既定を上書き）。 */
export const storybookPresignedHandler: HttpHandler = http.get(
  `${TEST_API_BASE}/videos/:videoId/playback_url`,
  () => HttpResponse.json(makePlaybackUrl(STORYBOOK_PRESIGNED_URL)),
);

/**
 * `<video src>` が署名 URL 先へ出す要求を MSW で受け止める（404）。
 * Service Worker はメディア要素の取得も intercept するため、これで再生ページ Story のメディア要求が
 * onUnhandledRequest のエラーにならず、かつ外部へ出ない。
 */
export const storybookMediaHandler: HttpHandler = http.get(
  "https://media.test.invalid/videos/*",
  () => new HttpResponse(null, { status: 404 }),
);

/**
 * Storybook の初期ハンドラ。MSW は先に一致したハンドラを使うため、Storybook 専用の上書きを
 * 既定ハンドラの前に置く。`parameters.msw.handlers` はさらにその前に差し込まれる。
 */
export const storybookHandlers: HttpHandler[] = [
  storybookPresignedHandler,
  storybookMediaHandler,
  ...handlers,
];

/** GET /videos: `upload_status` に関わらず同じ一覧を返す（MultiPage 等）。 */
export function listVideosHandler(rawVideos: RawVideo[]): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json(rawVideos));
}

/** GET /videos: `upload_status` ごとに一覧を出し分ける（FilteredEmpty 等。未指定の状態は空配列）。 */
export function listVideosByStatusHandler(
  byStatus: Partial<Record<UploadStatus, RawVideo[]>>,
): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
    const status = new URL(request.url).searchParams.get("upload_status");
    const rawVideos = status === "init" ? byStatus.init : byStatus.complete;
    return HttpResponse.json(rawVideos ?? []);
  });
}

/** GET /videos: 0 件（ApiClient は `empty` に正規化し、一覧は nodata 表示になる）。 */
export function emptyListHandler(): HttpHandler {
  return listVideosHandler([]);
}

/**
 * GET /videos の失敗（新 API 規約: HTTP ステータス + `{ detail }`）。
 * 既定は 503 upstream_unavailable で、ApiClient は transport 失敗に正規化する。
 */
export function listErrorHandler(status = 503, detail = "upstream_unavailable"): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos`, () => errorResponse(status, detail));
}

/** 任意エンドポイントの応答を無期限に保留し、loading 状態を固定する（Loading / Submitting 等）。 */
export function pendingHandler(method: ScenarioMethod, path: string): HttpHandler {
  return http[method](`${TEST_API_BASE}${path}`, async () => {
    await delay("infinite");
    // delay("infinite") は解決しないため到達しない。型のために応答を返す。
    return HttpResponse.json(null);
  });
}

/** 任意エンドポイントをネットワーク失敗にする（ApiClient は transport 失敗に正規化する）。 */
export function networkErrorHandler(method: ScenarioMethod, path: string): HttpHandler {
  return http[method](`${TEST_API_BASE}${path}`, () => HttpResponse.error());
}

/** GET /videos/{video_id}: 指定の動画を返す。 */
export function videoHandler(raw: RawVideo): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.json(raw));
}

/** GET /videos/{video_id}: 未存在（404 video_not_found）。ApiClient は notFound に正規化する。 */
export function videoNotFoundHandler(): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found"));
}

/** GET /videos/{id}/playback_url の失敗（404 video_not_found）。 */
export function presignedErrorHandler(): HttpHandler {
  return http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () =>
    errorResponse(404, "video_not_found"),
  );
}
