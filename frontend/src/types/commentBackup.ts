import { z } from "zod";

export const commentBackupSchema = z
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
    comment_count: z.number().nullish(),
    completed_at: z.number().nullish(),
  })
  .transform((raw) => ({
    videoId: raw.video_id,
    platform: raw.platform,
    state: raw.state,
    /** 直近に完了した取得の件数（再取得中も前回の値を保持する）。 */
    commentCount: raw.comment_count ?? null,
    /** 直近に完了した取得の時刻（epoch 秒）。 */
    completedAt: raw.completed_at ?? null,
  }));

export type CommentBackup = z.output<typeof commentBackupSchema>;
export type CommentBackupState = CommentBackup["state"];

/** backend の `PLATFORMS` と一致させる。 */
export function supportsCommentBackup(platform: string): boolean {
  return platform === "youtube";
}

/** 開始済みで backend が再投入しない状態（開始ボタンを無効にする）。 */
export function isCommentBackupInProgress(state: CommentBackupState): boolean {
  return state === "submitting" || state === "running";
}

/** 状態が変わる見込みがあり、照会を繰り返す状態（取り込み待ちを含む）。 */
export function shouldPollCommentBackup(state: CommentBackupState): boolean {
  return isCommentBackupInProgress(state) || state === "awaiting_ingest";
}
