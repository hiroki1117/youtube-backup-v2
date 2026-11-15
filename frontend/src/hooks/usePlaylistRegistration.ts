import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, apiErrorMessage } from "@/api/client";
import type { YoutubePlaylist, YoutubePlaylistVideo } from "@/types/youtubePlaylist";

export interface PlaylistRegistrationResult {
  /** バックアップを新しく開始した本数。 */
  started: number;
  /** 登録済みだった本数。 */
  existing: number;
  failed: { video: YoutubePlaylistVideo; message: string }[];
  /** 途中で止めた（残りは登録していない）。 */
  stopped: boolean;
}

export type PlaylistRegistrationState =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "preview"; playlist: YoutubePlaylist }
  | { step: "registering"; playlist: YoutubePlaylist; done: number }
  | { step: "finished"; playlist: YoutubePlaylist; result: PlaylistRegistrationResult };

/**
 * 再生リストを読み込み、確認後に動画を 1 本ずつ順に `POST /videos` する。登録済みの動画は backend が
 * 200 を返すだけなので、同じ再生リストを何度登録しても重複しない。
 * 止める・閉じる（アンマウント）と、実行中の 1 本が終わったところで止まる。
 */
export function usePlaylistRegistration() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PlaylistRegistrationState>({ step: "idle" });
  const stopRequested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRequested.current = true;
    };
  }, []);

  /** 成功で preview へ進む。失敗は理由を返して idle に戻る。 */
  const load = async (url: string): Promise<string | null> => {
    setState({ step: "loading" });
    const result = await apiClient.getYoutubePlaylist(url);
    if (!mounted.current) {
      return null;
    }
    if (result.kind === "ok") {
      setState({ step: "preview", playlist: result.data });
      return null;
    }
    setState({ step: "idle" });
    return result.message;
  };

  const run = async (playlist: YoutubePlaylist) => {
    stopRequested.current = false;
    const result: PlaylistRegistrationResult = {
      started: 0,
      existing: 0,
      failed: [],
      stopped: false,
    };
    setState({ step: "registering", playlist, done: 0 });
    for (const [index, video] of playlist.videos.entries()) {
      if (stopRequested.current) {
        result.stopped = true;
        break;
      }
      // 順に 1 本ずつ送る（同時に送ると Batch と YouTube への取得が一度に集中する）。
      const submitted = await apiClient.submitVideo(video.url);
      if (submitted.kind !== "ok") {
        result.failed.push({ video, message: apiErrorMessage(submitted) });
      } else if (submitted.data.alreadyBackedUp) {
        result.existing += 1;
      } else {
        result.started += 1;
      }
      if (mounted.current) {
        setState({ step: "registering", playlist, done: index + 1 });
      }
    }
    // 途中で止めても、登録できた分を一覧へ反映する。
    void queryClient.invalidateQueries({ queryKey: ["videos"] });
    if (mounted.current) {
      setState({ step: "finished", playlist, result });
    }
  };

  return {
    state,
    load,
    /** preview の動画をすべて登録する。 */
    register: () => {
      if (state.step === "preview") {
        void run(state.playlist);
      }
    },
    stop: () => {
      stopRequested.current = true;
    },
    reset: () => setState({ step: "idle" }),
  };
}
