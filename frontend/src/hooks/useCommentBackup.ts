import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResult, type CommentBackupStart } from "@/api/client";
import { notify } from "@/lib/notify";
import { shouldPollCommentBackup, type CommentBackup } from "@/types/commentBackup";

/**
 * コメントバックアップフック（`GET/POST /videos/{id}/comments/backup`）。
 * 状態を照会し、取得中・取り込み待ちの間は一定間隔で照会し直す（ジョブの完了を画面に反映する）。
 * `start()` で取得を開始（取得済みなら最新化）し、結果を通知する。
 * ApiClient が正規化した ApiResult を kind で判別する（表示テキストでは分岐しない）。
 */

/** 取得中の照会間隔。 */
export const COMMENT_BACKUP_POLL_MS = 5000;

export type CommentBackupView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; backup: CommentBackup };

export interface CommentBackupController {
  state: CommentBackupView;
  /** 取得を開始する。実行中の再呼び出しは無視する。 */
  start: () => Promise<void>;
  /** 開始要求の実行中フラグ。ボタンの無効化に使う。 */
  isStarting: boolean;
  /** 状態を照会し直す（error からの再試行）。 */
  refetch: () => void;
}

const TRANSPORT_MESSAGE = "通信に失敗しました。時間をおいて再試行してください。";

function toErrorMessage(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): string {
  switch (result.kind) {
    case "rejected":
    case "notFound":
    case "invalidInput":
      return result.message;
    case "transport":
      return TRANSPORT_MESSAGE;
    case "empty":
      return "コメントバックアップの状態を取得できませんでした。";
  }
}

/**
 * @param videoId 対象の動画
 * @param enabled 照会するか（対応プラットフォームの完了済み動画だけ true にする）
 */
export function useCommentBackup(videoId: string, enabled: boolean): CommentBackupController {
  const queryClient = useQueryClient();
  const queryKey = ["commentBackup", videoId];

  const query = useQuery<ApiResult<CommentBackup>, Error>({
    queryKey,
    queryFn: () => apiClient.getCommentBackup(videoId),
    enabled,
    refetchInterval: (q) => {
      const data = q.state.data;
      return data?.kind === "ok" && shouldPollCommentBackup(data.data.state)
        ? COMMENT_BACKUP_POLL_MS
        : false;
    },
  });

  const mutation = useMutation<ApiResult<CommentBackupStart>, Error, void>({
    mutationFn: () => apiClient.startCommentBackup(videoId),
  });

  const state = useMemo<CommentBackupView>(() => {
    if (query.data === undefined) {
      return query.isError ? { kind: "error", message: TRANSPORT_MESSAGE } : { kind: "loading" };
    }
    if (query.data.kind !== "ok") {
      return { kind: "error", message: toErrorMessage(query.data) };
    }
    return { kind: "ready", backup: query.data.data };
  }, [query.data, query.isError]);

  const start = async (): Promise<void> => {
    if (mutation.isPending) {
      return;
    }
    try {
      const result = await mutation.mutateAsync();
      if (result.kind !== "ok") {
        notify("error", toErrorMessage(result));
        return;
      }
      const latest: ApiResult<CommentBackup> = { kind: "ok", data: result.data.backup };
      queryClient.setQueryData(queryKey, latest);
      if (result.data.started) {
        notify("success", "コメントのバックアップを開始しました");
      } else {
        notify("info", "コメントはすでに取得中です");
      }
    } catch {
      notify("error", "コメントのバックアップの開始でエラーが発生しました。");
    }
  };

  return {
    state,
    start,
    isStarting: mutation.isPending,
    refetch: () => void query.refetch(),
  };
}
