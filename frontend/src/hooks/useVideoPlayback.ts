import { useQuery } from "@tanstack/react-query";
import { apiClient, apiErrorMessage } from "@/api/client";
import type { Video } from "@/types/video";
import type { ViewState } from "@/types/viewState";

export type PlaybackState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "notPlayable"; video: Video } // バックアップ未完了
  | { kind: "ready"; video: Video; source: ViewState<string> }; // source は署名 URL

const PLAYBACK_ERROR_MESSAGE =
  "再生用の URL を取得できませんでした。時間をおいて再試行してください。";

export function useVideoPlayback(videoId: string) {
  const detail = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => apiClient.getVideo(videoId),
  });

  const video = detail.data?.kind === "ok" ? detail.data.data : null;
  const isComplete = video?.uploadStatus === "complete";

  const presigned = useQuery({
    queryKey: ["presigned", videoId],
    queryFn: () => apiClient.getPresignedUrl(videoId),
    enabled: isComplete,
  });

  function currentState(): PlaybackState {
    const result = detail.data;
    if (result === undefined) {
      return { kind: "loading" };
    }
    if (result.kind === "notFound") {
      return { kind: "notFound" };
    }
    if (result.kind !== "ok") {
      return { kind: "error", message: apiErrorMessage(result) };
    }
    if (result.data.uploadStatus !== "complete") {
      return { kind: "notPlayable", video: result.data };
    }
    const url = presigned.data;
    let source: ViewState<string> = { status: "loading" };
    if (url !== undefined) {
      source =
        url.kind === "ok"
          ? { status: "ready", data: url.data }
          : { status: "error", message: apiErrorMessage(url, PLAYBACK_ERROR_MESSAGE) };
    }
    return { kind: "ready", video: result.data, source };
  }

  return {
    state: currentState(),
    refetch: () => {
      void detail.refetch();
      if (isComplete) {
        void presigned.refetch();
      }
    },
  };
}
