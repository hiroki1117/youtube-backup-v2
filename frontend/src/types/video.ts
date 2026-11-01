import { z } from "zod";

export type UploadStatus = "init" | "complete";

export interface Video {
  videoId: string;
  videoUrl: string;
  platform: string;
  title: string;
  backupDate: string; // YYYY-MM-DD
  s3FullPath: string;
  uploadStatus: UploadStatus;
  requestTimestamp: string | null; // epoch 秒（文字列）。旧レコードの不明な時刻は null。
}

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
  .transform((raw): Video => ({
    videoId: raw.video_id,
    videoUrl: raw.video_url,
    platform: raw.platform,
    title: raw.title,
    backupDate: raw.backupdate,
    s3FullPath: raw.s3fullpath,
    uploadStatus: raw.upload_status,
    requestTimestamp: raw.request_timestamp ?? null,
  }));
