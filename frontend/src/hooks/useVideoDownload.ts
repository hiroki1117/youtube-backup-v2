import { apiClient } from "@/api/client";
import { downloadPresignedUrl } from "@/lib/download";
import { notify } from "@/lib/notify";
import type { Video } from "@/types/video";
import { useApiAction } from "./useApiAction";

export function useVideoDownload() {
  const { run, isPending } = useApiAction({
    call: (video: Video) => apiClient.getPresignedUrl(video.videoId),
    onOk: (url, video) => {
      // 拡張子はサーバーの URL に委ねる。
      if (!downloadPresignedUrl(url, video.title.trim() || video.videoId)) {
        notify("error", "ダウンロード用 URL が無効です。");
      }
    },
  });
  return { download: run, isPreparing: isPending };
}
