import { z } from "zod";

/**
 * VideoModel ドメイン型（contract C3）。エンティティ `Video` の単一所有者。
 * API 境界では zod で parse した検証済み値のみ `Video` として扱う（`as` キャスト禁止）。
 * 命名は API のスネークケースをドメイン型でキャメルケースに正規化する。
 */

export type UploadStatus = "init" | "complete";

export interface Video {
  videoId: string; // PK（API の video_id）
  videoUrl: string;
  platform: string; // youtube | twitter | その他
  title: string;
  backupDate: string; // YYYY-MM-DD
  s3FullPath: string;
  uploadStatus: UploadStatus;
  requestTimestamp: string | null; // epoch 秒（文字列）。旧レコードの不明な時刻は null。
}

/**
 * API レスポンスの生形状。旧レコードの request_timestamp は欠落または null を許容する。
 * consumer は未知フィールドを無視する（後方互換）ため passthrough で許容する。
 */
const rawVideoSchema = z
  .object({
    video_id: z.string(),
    video_url: z.string(),
    platform: z.string(),
    title: z.string(),
    backupdate: z.string(),
    s3fullpath: z.string(),
    upload_status: z.union([z.literal("init"), z.literal("complete")]),
    request_timestamp: z.string().nullish(),
  })
  .passthrough();

/**
 * API 境界での検証（ApiClient が使用）。未検証値は Video として扱わず null を返す。
 * @param raw 検証前の未知の値
 * @returns 検証済み `Video`、不正なら null
 */
export function parseVideo(raw: unknown): Video | null {
  const result = rawVideoSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  const d = result.data;
  return {
    videoId: d.video_id,
    videoUrl: d.video_url,
    platform: d.platform,
    title: d.title,
    backupDate: d.backupdate,
    s3FullPath: d.s3fullpath,
    uploadStatus: d.upload_status,
    requestTimestamp: d.request_timestamp ?? null,
  };
}
