import { useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResult } from "@/api/client";
import { notify } from "@/lib/notify";
import type { Video } from "@/types/video";
import { useApiAction } from "./useApiAction";

/** 失敗時は `onSaved` を呼ばないので、編集中の入力は残る。 */
export function useVideoTitleEdit(videoId: string, onSaved: () => void) {
  const queryClient = useQueryClient();
  const { run, isPending } = useApiAction(
    (title: string) => apiClient.updateVideoTitle(videoId, title),
    (video) => {
      const latest: ApiResult<Video> = { kind: "ok", data: video };
      queryClient.setQueryData(["video", videoId], latest);
      void queryClient.invalidateQueries({ queryKey: ["videos"] });
      notify("success", "タイトルを更新しました");
      onSaved();
    },
  );
  return { save: run, isSaving: isPending };
}
