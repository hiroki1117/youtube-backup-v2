import { z } from "zod";

export const videoSchema = z
  .object({
    video_id: z.string(),
    video_url: z.string(),
    platform: z.string(),
    title: z.string(),
    backupdate: z.string(),
    s3fullpath: z.string(),
    upload_status: z.enum(["init", "complete"]),
    // 旧レコードでは欠落または null。
    request_timestamp: z.string().nullish(),
  })
  .transform((raw) => ({
    videoId: raw.video_id,
    videoUrl: raw.video_url,
    platform: raw.platform,
    title: raw.title,
    backupDate: raw.backupdate, // YYYY-MM-DD
    s3FullPath: raw.s3fullpath,
    uploadStatus: raw.upload_status,
    requestTimestamp: raw.request_timestamp ?? null, // epoch 秒（文字列）
  }));

export type Video = z.output<typeof videoSchema>;
export type UploadStatus = Video["uploadStatus"];

export const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
};

// 処理中（init）の動画に対する削除は、バックアップの取り消しになる。
export const REMOVE_LABEL: Record<UploadStatus, string> = {
  init: "取り消し",
  complete: "削除",
};
