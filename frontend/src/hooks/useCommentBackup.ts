import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, apiErrorMessage, type ApiResult } from "@/api/client";
import { notify } from "@/lib/notify";
import { shouldPollCommentBackup, type CommentBackup } from "@/types/commentBackup";
import type { ViewState } from "@/types/viewState";
import { useApiAction } from "./useApiAction";

const POLL_MS = 5000;

/**
 * コメントバックアップの状態を照会し、取得中・取り込み待ちの間は照会を繰り返す。
 * @param enabled 照会するか（対応プラットフォームの完了済み動画だけ true にする）
 */
export function useCommentBackup(videoId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = ["commentBackup", videoId];

  const query = useQuery({
    queryKey,
    queryFn: () => apiClient.getCommentBackup(videoId),
    enabled,
    refetchInterval: (q) => {
      const data = q.state.data;
      return data?.kind === "ok" && shouldPollCommentBackup(data.data.state) ? POLL_MS : false;
    },
  });

  const { run, isPending } = useApiAction({
    call: (_: void) => apiClient.startCommentBackup(videoId),
    onOk: ({ backup, started }) => {
      const latest: ApiResult<CommentBackup> = { kind: "ok", data: backup };
      queryClient.setQueryData(queryKey, latest);
      if (started) {
        notify("success", "コメントのバックアップを開始しました");
      } else {
        notify("info", "コメントはすでに取得中です");
      }
    },
  });

  const result = query.data;
  let state: ViewState<CommentBackup> = { status: "loading" };
  if (result !== undefined) {
    state =
      result.kind === "ok"
        ? { status: "ready", data: result.data }
        : { status: "error", message: apiErrorMessage(result) };
  }

  return { state, start: run, isStarting: isPending, refetch: () => void query.refetch() };
}
