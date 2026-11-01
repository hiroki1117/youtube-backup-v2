import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { notify } from "@/lib/notify";
import type { Video } from "@/types/video";
import { useApiAction } from "./useApiAction";

/** 削除の確認 → 実行 → 通知。完了済みは削除、未完了はバックアップの取り消しになる。 */
export function useVideoDeletion({ onDeleted }: { onDeleted?: (video: Video) => void } = {}) {
  const queryClient = useQueryClient();
  const [pendingVideo, setPendingVideo] = useState<Video | null>(null);

  const { run, isPending } = useApiAction(
    (video: Video) =>
      video.uploadStatus === "init"
        ? apiClient.cancelBackup(video.videoId)
        : apiClient.deleteVideo(video.videoId),
    (_, video) => {
      notify(
        "success",
        video.uploadStatus === "init"
          ? `バックアップを取り消しました: ${video.title}`
          : `動画を削除しました: ${video.title}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["videos"] });
      onDeleted?.(video);
    },
    () => setPendingVideo(null),
  );

  return {
    pendingVideo,
    requestDelete: (video: Video) => setPendingVideo(video),
    cancelDelete: () => setPendingVideo(null),
    confirmDelete: () => {
      if (pendingVideo !== null) {
        run(pendingVideo);
      }
    },
    isDeleting: isPending,
  };
}
