import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResult } from "@/api/client";
import { notify } from "@/lib/notify";
import type { Video } from "@/types/video";

/**
 * 動画削除フック（U5 video-deletion / US5.1・FR5.1・C2・C4）。
 * 削除確認 → 実行 → 結果通知を司る状態アダプタ。行アクション（C6 onDelete）から
 * `requestDelete(video)` で対象を pending にして確認ダイアログを開き、`confirmDelete()` で
 * `apiClient.deleteVideo(videoId)` を実行する。ApiClient が正規化した型付き失敗値（ApiResult）を
 * kind で判別して通知（C4）へ橋渡しする。
 *
 * レイヤ境界: hooks は api / lib / types のみに依存する。API 失敗の捕捉・分類は ApiClient 層に
 * 一元化済みで、ここでは try/catch を分散させず discriminated union の kind で分岐する
 * （表示テキストで制御分岐しない）。バックアップ中（init かつタイムアウト未経過）の削除拒否は
 * サーバー権威で `rejected(backupInProgress)` として返る（クライアントで削除可否を推測しない / R-02）。
 */

export interface VideoDeletionController {
  /** 現在削除確認中の対象動画（null = 確認ダイアログ非表示）。 */
  pendingVideo: Video | null;
  /**
   * 行の削除ボタン（C6 onDelete）から呼ぶ。対象を pending にして確認ダイアログを開く。
   * 即削除はしない（削除前に確認する / FR5.1）。
   */
  requestDelete: (video: Video) => void;
  /** 確認をキャンセルする。pending をクリアしダイアログを閉じる。 */
  cancelDelete: () => void;
  /** 確認を確定して削除を実行する。実行中の再確定・pending 不在時の呼び出しは無視する（二重確定抑止）。 */
  confirmDelete: () => void;
  /** 削除実行中フラグ（=useMutation.isPending）。確定ボタンの無効化に使う。 */
  isDeleting: boolean;
}

/**
 * ok 以外の ApiResult を人間可読なエラーメッセージへ変換する。
 * 分岐は discriminated union の kind で行う（表示テキストでは分岐しない）。
 * `rejected`（バックアップ中拒否等）・`notFound` はサーバー由来 message をそのまま提示する。
 */
function toErrorMessage(result: Exclude<ApiResult<null>, { kind: "ok" }>): string {
  switch (result.kind) {
    case "rejected":
    case "notFound":
    case "invalidInput":
      return result.message;
    case "transport":
      return "通信に失敗しました。時間をおいて再試行してください。";
    case "empty":
      return "削除結果を取得できませんでした。";
  }
}

export function useVideoDeletion(): VideoDeletionController {
  const queryClient = useQueryClient();
  const [pendingVideo, setPendingVideo] = useState<Video | null>(null);
  // isPending がまだ true へ反映される前の同期的な連打も抑止するための実行中フラグ。
  const inFlight = useRef(false);

  const mutation = useMutation<ApiResult<null>, Error, Video>({
    // deleteVideo は例外を投げず ApiResult を解決する契約（C2）。
    mutationFn: (video) => apiClient.deleteVideo(video.videoId),
    onSuccess: (result, video) => {
      if (result.kind === "ok") {
        notify("success", `動画を削除しました: ${video.title}`);
        // 削除された行を一覧へ反映する（US5.1）。prefix ["videos"] を全件無効化して再取得させる。
        void queryClient.invalidateQueries({ queryKey: ["videos"] });
        return;
      }
      // 業務拒否（backupInProgress 等）・未存在・transport は一覧を変更しない（一覧不変 / R-02）。
      notify("error", toErrorMessage(result));
    },
    onError: () => {
      // 契約上ここには来ないが、想定外の throw も silent failure にしない（FR8 / Construction ガードレール）。
      notify("error", "削除処理でエラーが発生しました。");
    },
    onSettled: () => {
      inFlight.current = false;
      // 成功・失敗いずれも処理後は pending をクリアし確認ダイアログを閉じる。
      setPendingVideo(null);
    },
  });

  const requestDelete = useCallback((video: Video) => {
    setPendingVideo(video);
  }, []);

  const cancelDelete = useCallback(() => {
    setPendingVideo(null);
  }, []);

  const confirmDelete = useCallback(() => {
    if (inFlight.current || pendingVideo === null) {
      return;
    }
    inFlight.current = true;
    mutation.mutate(pendingVideo);
  }, [mutation, pendingVideo]);

  return {
    pendingVideo,
    requestDelete,
    cancelDelete,
    confirmDelete,
    isDeleting: mutation.isPending,
  };
}
