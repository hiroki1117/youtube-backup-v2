import { z } from "zod";
import { parseVideo, type UploadStatus, type Video } from "@/types/video";
import { config } from "./config";
import { getIdToken } from "@/api/token";

/**
 * ApiClient インターフェース契約（contract C2）。
 * 唯一の HTTP 境界。新 API（openapi/openapi.json: /videos 系・Cognito JWT 必須・エラーは HTTP ステータス +
 * `{ detail }`）の応答を、消費側へは discriminated union の型付き値（ApiResult<T>）として渡す（例外を投げない）。
 * 全リクエストに Cognito ID トークンを `Authorization: Bearer` で付与する。
 */

export type ApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "empty" } // 該当なし（例: 一覧 0 件）
  | { kind: "notFound"; message: string } // 404
  | { kind: "rejected"; reason: RejectReason; message: string } // 業務ルール上の拒否（409）
  | { kind: "invalidInput"; message: string } // URL/ID 不正（422）
  | { kind: "transport"; message: string }; // ネットワーク/認証切れ/サーバー障害/パース失敗

export type RejectReason = "backupInProgress" | "alreadyBackedUp" | "serverError";

export interface SubmitResult {
  videoId: string;
  title: string;
  alreadyBackedUp: boolean;
  batchJobId: string;
}

export interface ApiClient {
  listVideos(params: {
    uploadStatus: UploadStatus;
    fetchNum?: number;
  }): Promise<ApiResult<Video[]>>;
  getVideo(videoId: string): Promise<ApiResult<Video>>;
  submitVideo(url: string): Promise<ApiResult<SubmitResult>>;
  /** タイトルを更新する（`PATCH /videos/{id}`）。成功は更新後の Video。 */
  updateVideoTitle(videoId: string, title: string): Promise<ApiResult<Video>>;
  /** 完了済み動画の削除（`DELETE /videos/{id}`）。成功は 204（本文なし）。 */
  deleteVideo(videoId: string): Promise<ApiResult<null>>;
  /**
   * 未完了バックアップの取り消し（`DELETE /videos/{id}/backup`）。実行中のジョブを止めて未完了の
   * 動画記録を消す。成功は 204（本文なし）。
   */
  cancelBackup(videoId: string): Promise<ApiResult<null>>;
  /** 再生/ダウンロード用の署名付き URL（`GET /videos/{id}/playback_url`）。 */
  getPresignedUrl(videoId: string): Promise<ApiResult<string>>;
}

// 失敗バリアント（ok/empty を除く）。
type ApiFailure = Extract<
  ApiResult<never>,
  { kind: "notFound" } | { kind: "rejected" } | { kind: "invalidInput" } | { kind: "transport" }
>;

const registrationSchema = z.object({
  video: z.unknown(),
  backup: z.object({
    video_id: z.string(),
    state: z.string(),
    batch_job_id: z.string().nullable().optional(),
  }),
  already_registered: z.boolean(),
});

const playbackSchema = z.object({
  url: z.string(),
  expires_in: z.number(),
});

const errorBodySchema = z.object({ detail: z.unknown() });

// サーバーが返す `detail` コード → 利用者向けメッセージ（コードは画面に出さない）。
const DETAIL_MESSAGES: Record<string, string> = {
  video_not_found: "動画が見つかりません。",
  invalid_url: "URL の形式が正しくありません。",
  invalid_youtube_id: "YouTube の動画 URL として認識できません。",
  twitter_registration_not_migrated: "Twitter の動画登録にはまだ対応していません。",
  backup_not_complete: "バックアップが完了していないため実行できません。",
  backup_already_complete: "バックアップは完了しています。取り消しではなく削除してください。",
  backup_object_needs_reconciliation:
    "動画の保存が完了しつつあるか、確認が必要なため今は削除・取り消しできません。しばらくしてから再試行してください。",
  concurrent_change: "他の処理と競合しました。時間をおいて再試行してください。",
  job_needs_reconciliation: "バックアップの状態確認が必要です。",
  submission_needs_reconciliation: "バックアップの状態確認が必要です。",
  legacy_job_untracked: "バックアップの状態確認が必要です。",
  deletion_needs_reconciliation: "削除処理が未完了です。管理者に確認してください。",
};

// 409 のうち「バックアップ処理が絡んで今は実行できない」もの（UI は backupInProgress として扱う）。
const IN_PROGRESS_CODES = new Set([
  "backup_not_complete",
  "backup_object_needs_reconciliation",
  "concurrent_change",
  "job_needs_reconciliation",
  "submission_needs_reconciliation",
]);

type RawFetch = { ok: true; body: unknown } | { ok: false; failure: ApiFailure };

/** HTTP ステータスと `{ detail }` から ApiResult の失敗種別へ正規化する（C2 実装契約）。 */
function classifyFailure(status: number, body: unknown): ApiFailure {
  const parsed = errorBodySchema.safeParse(body);
  const code = parsed.success && typeof parsed.data.detail === "string" ? parsed.data.detail : "";
  const message = DETAIL_MESSAGES[code];
  switch (status) {
    case 401:
      return {
        kind: "transport",
        message: "認証が切れました。再度ログインしてください。",
      };
    case 404:
      return { kind: "notFound", message: message ?? "対象が見つかりません。" };
    case 409:
      return {
        kind: "rejected",
        reason: IN_PROGRESS_CODES.has(code) ? "backupInProgress" : "serverError",
        message: message ?? "処理を実行できませんでした。",
      };
    case 422:
      return { kind: "invalidInput", message: message ?? "入力内容が正しくありません。" };
    default:
      return { kind: "transport", message: `HTTP ${status}` };
  }
}

export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | null>;

  constructor(
    baseUrl: string = config.apiBaseUrl,
    getToken: () => Promise<string | null> = getIdToken,
  ) {
    // 末尾スラッシュを正規化
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.getToken = getToken;
  }

  /** 単一 fetch ラッパ。失敗は型付き値に変換し、例外を投げない。204 の本文は null。 */
  private async request(path: string, init?: RequestInit): Promise<RawFetch> {
    try {
      const token = await this.getToken();
      if (!token) {
        return {
          ok: false,
          failure: { kind: "transport", message: "認証が切れました。再度ログインしてください。" },
        };
      }
      const hasBody = init?.body !== undefined && init?.body !== null;
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
      const body: unknown =
        response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        return { ok: false, failure: classifyFailure(response.status, body) };
      }
      return { ok: true, body };
    } catch (e) {
      return {
        ok: false,
        failure: { kind: "transport", message: e instanceof Error ? e.message : "network error" },
      };
    }
  }

  async listVideos(params: {
    uploadStatus: UploadStatus;
    fetchNum?: number;
  }): Promise<ApiResult<Video[]>> {
    const fetchNum = params.fetchNum ?? 30;
    const query = `upload_status=${encodeURIComponent(params.uploadStatus)}&fetch_num=${fetchNum}`;
    const res = await this.request(`/videos?${query}`);
    if (!res.ok) {
      return res.failure;
    }
    if (!Array.isArray(res.body)) {
      return { kind: "transport", message: "expected an array response for GET /videos" };
    }
    if (res.body.length === 0) {
      return { kind: "empty" };
    }
    const videos: Video[] = [];
    for (const item of res.body) {
      const video = parseVideo(item);
      if (video === null) {
        return { kind: "transport", message: "video schema mismatch in GET /videos" };
      }
      videos.push(video);
    }
    return { kind: "ok", data: videos };
  }

  async getVideo(videoId: string): Promise<ApiResult<Video>> {
    const res = await this.request(`/videos/${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      return res.failure;
    }
    const video = parseVideo(res.body);
    if (video === null) {
      return { kind: "transport", message: "video schema mismatch in GET /videos/{id}" };
    }
    return { kind: "ok", data: video };
  }

  async submitVideo(url: string): Promise<ApiResult<SubmitResult>> {
    const res = await this.request(`/videos`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      return res.failure;
    }
    const parsed = registrationSchema.safeParse(res.body);
    const video = parsed.success ? parseVideo(parsed.data.video) : null;
    if (!parsed.success || video === null) {
      return { kind: "transport", message: "unexpected response shape for POST /videos" };
    }
    // already_registered=true も ok として返す（UI は既登録通知）
    return {
      kind: "ok",
      data: {
        videoId: video.videoId,
        title: video.title,
        alreadyBackedUp: parsed.data.already_registered,
        batchJobId: parsed.data.backup.batch_job_id ?? "",
      },
    };
  }

  async updateVideoTitle(videoId: string, title: string): Promise<ApiResult<Video>> {
    const res = await this.request(`/videos/${encodeURIComponent(videoId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      return res.failure;
    }
    const video = parseVideo(res.body);
    if (video === null) {
      return { kind: "transport", message: "video schema mismatch in PATCH /videos/{id}" };
    }
    return { kind: "ok", data: video };
  }

  async deleteVideo(videoId: string): Promise<ApiResult<null>> {
    const res = await this.request(`/videos/${encodeURIComponent(videoId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      return res.failure;
    }
    return { kind: "ok", data: null };
  }

  async cancelBackup(videoId: string): Promise<ApiResult<null>> {
    const res = await this.request(`/videos/${encodeURIComponent(videoId)}/backup`, {
      method: "DELETE",
    });
    if (!res.ok) {
      return res.failure;
    }
    return { kind: "ok", data: null };
  }

  async getPresignedUrl(videoId: string): Promise<ApiResult<string>> {
    const res = await this.request(`/videos/${encodeURIComponent(videoId)}/playback_url`);
    if (!res.ok) {
      return res.failure;
    }
    const parsed = playbackSchema.safeParse(res.body);
    if (!parsed.success) {
      return { kind: "transport", message: "unexpected response shape for GET playback_url" };
    }
    return { kind: "ok", data: parsed.data.url };
  }
}

/** アプリ全体で共有する ApiClient 実体。 */
export const apiClient: ApiClient = new HttpApiClient();
