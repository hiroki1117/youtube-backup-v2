import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResult } from "@/api/client";
import { notify } from "@/lib/notify";
import type { Video } from "@/types/video";

/**
 * 動画タイトル編集フック（`PATCH /videos/{id}`）。
 * `save(title)` で更新を実行し、成功時は詳細（["video", id]）と一覧（["videos"]）のキャッシュを
 * 更新して `true` を、失敗時は通知を出して `false` を返す（呼び出し側は入力内容を残したまま再試行できる）。
 * ApiClient が正規化した ApiResult を kind で判別する（表示テキストでは分岐しない）。
 */

export interface VideoTitleEditController {
  /** タイトルを保存する。成功なら true。実行中の再呼び出しは無視して false。 */
  save: (title: string) => Promise<boolean>;
  /** 保存実行中フラグ。入力・ボタンの無効化に使う。 */
  isSaving: boolean;
}

function toErrorMessage(result: Exclude<ApiResult<Video>, { kind: "ok" }>): string {
  switch (result.kind) {
    case "rejected":
    case "notFound":
    case "invalidInput":
      return result.message;
    case "transport":
      return "通信に失敗しました。時間をおいて再試行してください。";
    case "empty":
      return "更新結果を取得できませんでした。";
  }
}

export function useVideoTitleEdit(videoId: string): VideoTitleEditController {
  const queryClient = useQueryClient();

  const mutation = useMutation<ApiResult<Video>, Error, string>({
    mutationFn: (title) => apiClient.updateVideoTitle(videoId, title),
  });

  const save = async (title: string): Promise<boolean> => {
    if (mutation.isPending) {
      return false;
    }
    try {
      const result = await mutation.mutateAsync(title);
      if (result.kind !== "ok") {
        notify("error", toErrorMessage(result));
        return false;
      }
      queryClient.setQueryData<ApiResult<Video>>(["video", videoId], result);
      void queryClient.invalidateQueries({ queryKey: ["videos"] });
      notify("success", "タイトルを更新しました");
      return true;
    } catch {
      notify("error", "タイトルの更新でエラーが発生しました。");
      return false;
    }
  };

  return { save, isSaving: mutation.isPending };
}
