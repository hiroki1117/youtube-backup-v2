import { z } from "zod";
import { commentBackupSchema } from "@/types/commentBackup";
import { videoSchema, type UploadStatus } from "@/types/video";
import { youtubeCommentPageSchema } from "@/types/youtubeComments";
import { youtubePlaylistSchema } from "@/types/youtubePlaylist";
import { getIdToken } from "@/api/token";
import { config } from "./config";

/**
 * 唯一の HTTP 境界。例外を投げず、応答を zod で検証した ApiResult にして返す。
 * 失敗の種類: 404 → notFound、409 → rejected、422 → invalidInput、それ以外（ネットワーク・認証切れ・
 * サーバー障害・想定外の形）→ transport。
 */
export type ApiFailure = {
  kind: "notFound" | "rejected" | "invalidInput" | "transport";
  message: string;
};

export type ApiResult<T> = { kind: "ok"; data: T } | ApiFailure;

const TRANSPORT_MESSAGE = "通信に失敗しました。時間をおいて再試行してください。";
const AUTH_EXPIRED_MESSAGE = "認証が切れました。再度ログインしてください。";

/** 失敗を利用者向けの文言にする。transport の詳細は画面に出さない。 */
export function apiErrorMessage(failure: ApiFailure, transportMessage = TRANSPORT_MESSAGE): string {
  return failure.kind === "transport" ? transportMessage : failure.message;
}

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
  comments_not_supported: "この動画のプラットフォームはコメントのバックアップに対応していません。",
  not_a_youtube_playlist: "YouTube の再生リストの URL として認識できません。",
  unsupported_playlist: "ミックス・後で見る・高く評価した動画の再生リストは読み込めません。",
  playlist_not_found: "再生リストが見つかりません。非公開の再生リストは読み込めません。",
  playlist_unavailable: "再生リストを読み込めませんでした。時間をおいて再試行してください。",
  search_condition_required: "検索条件を入力してください。",
  invalid_backup_date_range: "バックアップ日の範囲が正しくありません。",
};

function toFailure(status: number, body: unknown): ApiFailure {
  const error = z.object({ detail: z.string() }).safeParse(body);
  const message = error.success ? DETAIL_MESSAGES[error.data.detail] : undefined;
  switch (status) {
    case 401:
      return { kind: "transport", message: AUTH_EXPIRED_MESSAGE };
    case 404:
      return { kind: "notFound", message: message ?? "対象が見つかりません。" };
    case 409:
      return { kind: "rejected", message: message ?? "処理を実行できませんでした。" };
    case 422:
      return { kind: "invalidInput", message: message ?? "入力内容が正しくありません。" };
    default:
      // 502 など、意味の分かるコード（例: playlist_unavailable）だけ利用者向けの文言にする。
      return { kind: "transport", message: message ?? `HTTP ${status}` };
  }
}

function decode<S extends z.ZodType>(
  schema: S,
  body: unknown,
  path: string,
): ApiResult<z.output<S>> {
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { kind: "ok", data: parsed.data }
    : { kind: "transport", message: `unexpected response for ${path}` };
}

const registrationSchema = z
  .object({
    video: videoSchema,
    backup: z.object({ video_id: z.string(), state: z.string() }),
    already_registered: z.boolean(),
  })
  .transform(({ video, already_registered }) => ({
    videoId: video.videoId,
    title: video.title,
    alreadyBackedUp: already_registered,
  }));

const searchResultsSchema = z
  .object({ items: z.array(videoSchema), has_more: z.boolean() })
  .transform((raw) => ({
    videos: raw.items,
    /** `limit` を超えて該当する動画があれば true。 */
    hasMore: raw.has_more,
  }));

export type VideoSearchResult = z.output<typeof searchResultsSchema>;

const playbackSchema = z
  .object({ url: z.string(), expires_in: z.number() })
  .transform((raw) => raw.url);

// 204 など本文を使わない応答。
const noContentSchema = z.unknown().transform(() => null);

const videoPath = (videoId: string) => `/videos/${encodeURIComponent(videoId)}`;

export function createApiClient(
  baseUrl: string = config.apiBaseUrl,
  getToken: () => Promise<string | null> = getIdToken,
) {
  const root = baseUrl.replace(/\/+$/, "");

  async function send(
    path: string,
    init?: RequestInit,
  ): Promise<ApiResult<{ status: number; body: unknown }>> {
    try {
      const token = await getToken();
      if (!token) {
        return { kind: "transport", message: AUTH_EXPIRED_MESSAGE };
      }
      const response = await fetch(`${root}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
        },
      });
      const body: unknown =
        response.status === 204 ? null : await response.json().catch(() => null);
      return response.ok
        ? { kind: "ok", data: { status: response.status, body } }
        : toFailure(response.status, body);
    } catch (e) {
      return { kind: "transport", message: e instanceof Error ? e.message : "network error" };
    }
  }

  async function request<S extends z.ZodType>(
    schema: S,
    path: string,
    init?: RequestInit,
  ): Promise<ApiResult<z.output<S>>> {
    const result = await send(path, init);
    return result.kind === "ok" ? decode(schema, result.data.body, path) : result;
  }

  return {
    listVideos({ uploadStatus, fetchNum = 30 }: { uploadStatus: UploadStatus; fetchNum?: number }) {
      const query = `upload_status=${encodeURIComponent(uploadStatus)}&fetch_num=${fetchNum}`;
      return request(z.array(videoSchema), `/videos?${query}`);
    },

    getVideo: (videoId: string) => request(videoSchema, videoPath(videoId)),

    /** 動画の検索。毎時同期の複製を読む。 */
    searchVideos(params: {
      query: string;
      backupFrom?: string;
      backupTo?: string;
      limit?: number;
    }) {
      const { query, backupFrom, backupTo, limit } = params;
      const search = new URLSearchParams();
      if (query !== "") {
        search.set("q", query);
      }
      if (backupFrom) {
        search.set("backup_from", backupFrom);
      }
      if (backupTo) {
        search.set("backup_to", backupTo);
      }
      if (limit !== undefined) {
        search.set("limit", String(limit));
      }
      return request(searchResultsSchema, `/search/videos?${search.toString()}`);
    },

    /** 登録済みの URL も ok で返す（`alreadyBackedUp`）。 */
    submitVideo: (url: string) =>
      request(registrationSchema, "/videos", { method: "POST", body: JSON.stringify({ url }) }),

    updateVideoTitle: (videoId: string, title: string) =>
      request(videoSchema, videoPath(videoId), {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),

    /** 完了済み動画の削除。 */
    deleteVideo: (videoId: string) =>
      request(noContentSchema, videoPath(videoId), { method: "DELETE" }),

    /** 未完了バックアップの取り消し。実行中のジョブを止めて未完了の動画記録を消す。 */
    cancelBackup: (videoId: string) =>
      request(noContentSchema, `${videoPath(videoId)}/backup`, { method: "DELETE" }),

    /** 再生・ダウンロード用の署名付き URL。 */
    getPresignedUrl: (videoId: string) =>
      request(playbackSchema, `${videoPath(videoId)}/playback_url`),

    getCommentBackup: (videoId: string) =>
      request(commentBackupSchema, `${videoPath(videoId)}/comments/backup`),

    /** コメントの取得を開始する（取得済みなら最新化）。取得中で何もしなければ `started: false`。 */
    async startCommentBackup(videoId: string) {
      const path = `${videoPath(videoId)}/comments/backup`;
      const sent = await send(path, { method: "POST" });
      if (sent.kind !== "ok") {
        return sent;
      }
      const backup = decode(commentBackupSchema, sent.data.body, path);
      return backup.kind === "ok"
        ? ({
            kind: "ok",
            data: { backup: backup.data, started: sent.data.status === 202 },
          } as const)
        : backup;
    },

    /** スレッド単位のページ。固定コメント→新しい順。 */
    getYoutubeComments: (videoId: string, { offset, limit }: { offset: number; limit: number }) =>
      request(
        youtubeCommentPageSchema,
        `${videoPath(videoId)}/comments?offset=${offset}&limit=${limit}`,
      ),

    /** 再生リストの動画一覧。URL の解釈は backend が行い、何も登録しない。 */
    getYoutubePlaylist: (url: string) =>
      request(youtubePlaylistSchema, `/youtube/playlist?url=${encodeURIComponent(url)}`),
  };
}

export const apiClient = createApiClient();
