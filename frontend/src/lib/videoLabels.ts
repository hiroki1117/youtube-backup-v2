import type { UploadStatus } from "@/types/video";

export const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
};

// 処理中（init）の動画に対する削除は、バックアップの取り消しになる。
export const REMOVE_LABEL: Record<UploadStatus, string> = {
  init: "取り消し",
  complete: "削除",
};
