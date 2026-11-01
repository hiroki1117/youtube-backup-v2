import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiErrorMessage, type ApiResult } from "@/api/client";
import { notify } from "@/lib/notify";

/**
 * ボタンから起動する API 操作の共通処理。失敗は通知し、実行中の再呼び出しは無視する。
 * ApiClient は例外を投げないので、結果の分岐はここだけで足りる。
 */
export function useApiAction<V, T>(
  call: (variables: V) => Promise<ApiResult<T>>,
  onOk: (data: T, variables: V) => void,
  onSettled?: () => void,
) {
  // isPending が true へ反映される前の同期的な連打も抑止する。
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: call,
    onSuccess: (result, variables) => {
      if (result.kind === "ok") {
        onOk(result.data, variables);
      } else {
        notify("error", apiErrorMessage(result));
      }
    },
    onSettled: () => {
      inFlight.current = false;
      onSettled?.();
    },
  });

  const run = (variables: V) => {
    if (!inFlight.current) {
      inFlight.current = true;
      mutation.mutate(variables);
    }
  };

  return { run, isPending: mutation.isPending };
}
