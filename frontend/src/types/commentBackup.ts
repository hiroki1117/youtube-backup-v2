import { z } from "zod";

/**
 * コメントバックアップのドメイン型（`GET/POST /videos/{id}/comments/backup` の CommentBackup）。
 * 要求の追跡状態だけを表し、コメント本文は含まない。API 境界では zod で parse した値のみ扱う。
 */

export type CommentBackupState =
  | "not_started" // まだ取得していない
  | "submitting" // ジョブ投入中
  | "running" // ジョブ実行中
  | "awaiting_ingest" // ジョブ成功・DynamoDB への取り込み待ち
  | "complete"
  | "failed";

export interface CommentBackup {
  videoId: string;
  platform: string;
  state: CommentBackupState;
  /** 直近に完了した取得の件数（再取得中も前回の値を保持する）。 */
  commentCount: number | null;
  /** 直近に完了した取得の時刻（epoch 秒）。 */
  completedAt: number | null;
}

/** コメントのバックアップに対応するプラットフォーム（backend の `PLATFORMS` と一致させる）。 */
const COMMENT_PLATFORMS = new Set(["youtube"]);

export function supportsCommentBackup(platform: string): boolean {
  return COMMENT_PLATFORMS.has(platform);
}

/** 開始済みで backend が再投入しない状態（開始ボタンを無効にする）。 */
export function isCommentBackupInProgress(state: CommentBackupState): boolean {
  return state === "submitting" || state === "running";
}

/** 状態が変わる見込みがあり、照会を繰り返す状態（取り込み待ちを含む）。 */
export function shouldPollCommentBackup(state: CommentBackupState): boolean {
  return isCommentBackupInProgress(state) || state === "awaiting_ingest";
}

const rawCommentBackupSchema = z
  .object({
    video_id: z.string(),
    platform: z.string(),
    state: z.enum([
      "not_started",
      "submitting",
      "running",
      "awaiting_ingest",
      "complete",
      "failed",
    ]),
    comment_count: z.number().nullable().optional(),
    completed_at: z.number().nullable().optional(),
  })
  .passthrough();

/**
 * API 境界での検証（ApiClient が使用）。未検証値は CommentBackup として扱わず null を返す。
 * @param raw 検証前の未知の値
 * @returns 検証済み `CommentBackup`、不正なら null
 */
export function parseCommentBackup(raw: unknown): CommentBackup | null {
  const result = rawCommentBackupSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  const d = result.data;
  return {
    videoId: d.video_id,
    platform: d.platform,
    state: d.state,
    commentCount: d.comment_count ?? null,
    completedAt: d.completed_at ?? null,
  };
}
