import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiResult, type SubmitResult } from "@/api/client";
import { notify } from "@/lib/notify";

/**
 * 動画登録フック（U4 video-registration / US4.1・FR4.1・FR4.2・C2・C4）。
 * `useMutation` で `apiClient.submitVideo(url)` を実行し、ApiClient が正規化した
 * 型付き失敗値（ApiResult）を kind で判別して通知（C4）へ橋渡しする薄いアダプタ。
 *
 * レイヤ境界: hooks は api / lib / types のみに依存する。API 失敗の捕捉・分類は
 * ApiClient 層に一元化済みで、ここでは try/catch を分散させず discriminated union を分岐する
 * （表示テキストで制御分岐しない）。
 */

export interface VideoRegistrationController {
  /** URL を登録する。実行中の再呼び出しは無視される（二重送信抑止 / US4.1）。 */
  submit: (url: string) => void;
  /** 送信中フラグ（=useMutation.isPending）。送信ボタンの無効化に使う。 */
  isSubmitting: boolean;
}

export interface UseVideoRegistrationOptions {
  /** 登録要求が受理された（ok）ときに呼ばれる。ダイアログの閉じ処理などに使う。 */
  onRegistered?: () => void;
}

/**
 * ok 以外の ApiResult を人間可読なエラーメッセージへ変換する。
 * 分岐は discriminated union の kind で行う（表示テキストでは分岐しない）。
 * 再生リストの一括登録（usePlaylistRegistration）でも動画ごとの失敗理由に使う。
 */
export function toErrorMessage(result: Exclude<ApiResult<SubmitResult>, { kind: "ok" }>): string {
  switch (result.kind) {
    case "invalidInput":
    case "rejected":
    case "notFound":
      return result.message;
    case "transport":
      return "通信に失敗しました。時間をおいて再試行してください。";
    case "empty":
      return "登録結果を取得できませんでした。";
  }
}

export function useVideoRegistration(
  options: UseVideoRegistrationOptions = {},
): VideoRegistrationController {
  const queryClient = useQueryClient();
  // isPending がまだ true へ反映される前の同期的な連打も抑止するための実行中フラグ。
  const inFlight = useRef(false);

  const mutation = useMutation<ApiResult<SubmitResult>, Error, string>({
    // submitVideo は例外を投げず ApiResult を解決する契約（C2）。
    mutationFn: (url) => apiClient.submitVideo(url),
    onSuccess: (result) => {
      if (result.kind === "ok") {
        if (result.data.alreadyBackedUp) {
          notify("info", `既にバックアップ済みです: ${result.data.title}`);
        } else {
          notify("success", `バックアップを開始しました: ${result.data.title}`);
        }
        // 登録直後の init エントリを一覧へ反映する（FR4.2）。prefix ["videos"] を全件無効化。
        void queryClient.invalidateQueries({ queryKey: ["videos"] });
        options.onRegistered?.();
        return;
      }
      notify("error", toErrorMessage(result));
    },
    onError: () => {
      // 契約上ここには来ないが、想定外の throw も silent failure にしない（FR8 / Construction ガードレール）。
      notify("error", "登録処理でエラーが発生しました。");
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const submit = useCallback(
    (url: string) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      mutation.mutate(url);
    },
    [mutation],
  );

  return { submit, isSubmitting: mutation.isPending };
}
