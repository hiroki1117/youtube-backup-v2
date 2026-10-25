import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import type { YoutubePlaylist, YoutubePlaylistVideo } from "@/types/youtubePlaylist";
import { toErrorMessage } from "./useVideoRegistration";

/**
 * 再生リストからの一括登録フック。
 * 再生リストを読み込み（`GET /youtube/playlist`）、確認後に動画を 1 本ずつ順に `POST /videos` する。
 * 登録済みの動画は backend が 200 を返すだけなので、同じ再生リストを何度登録しても重複しない。
 * 途中で止める・ダイアログを閉じる（アンマウント）と、実行中の 1 本が終わったところで止まる。
 *
 * 状態は discriminated union（step）で表し、表示テキストでは分岐しない。
 */

export interface PlaylistRegistrationFailure {
  video: YoutubePlaylistVideo;
  message: string;
}

export interface PlaylistRegistrationResult {
  /** バックアップを新しく開始した本数。 */
  started: number;
  /** 登録済みだった本数。 */
  existing: number;
  failed: PlaylistRegistrationFailure[];
  /** 途中で止めた（残りは登録していない）。 */
  stopped: boolean;
}

export type PlaylistRegistrationState =
  | { step: "idle" }
  | { step: "loading" }
  | { step: "preview"; playlist: YoutubePlaylist }
  | { step: "registering"; playlist: YoutubePlaylist; done: number }
  | { step: "finished"; playlist: YoutubePlaylist; result: PlaylistRegistrationResult };

export interface PlaylistRegistrationController {
  state: PlaylistRegistrationState;
  /** 再生リストを読み込む。成功で preview へ進み、失敗は理由を返して idle に戻る。 */
  load: (url: string) => Promise<string | null>;
  /** preview の動画をすべて登録する。 */
  register: () => void;
  /** 登録中なら、実行中の 1 本が終わったところで止める。 */
  stop: () => void;
  /** 入力に戻る（preview・finished から）。 */
  reset: () => void;
}

export function usePlaylistRegistration(): PlaylistRegistrationController {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PlaylistRegistrationState>({ step: "idle" });
  const stopRequested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // 閉じたら残りは登録しない（実行中の 1 本は backend で完了する）。
      mounted.current = false;
      stopRequested.current = true;
    };
  }, []);

  const load = useCallback(async (url: string) => {
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
    return result.kind === "empty" ? "再生リストを読み込めませんでした。" : result.message;
  }, []);

  const run = useCallback(
    async (playlist: YoutubePlaylist) => {
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
        if (submitted.kind === "ok") {
          if (submitted.data.alreadyBackedUp) {
            result.existing += 1;
          } else {
            result.started += 1;
          }
        } else {
          result.failed.push({ video, message: toErrorMessage(submitted) });
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
    },
    [queryClient],
  );

  const register = useCallback(() => {
    if (state.step === "preview") {
      void run(state.playlist);
    }
  }, [run, state]);

  const stop = useCallback(() => {
    stopRequested.current = true;
  }, []);

  const reset = useCallback(() => {
    setState({ step: "idle" });
  }, []);

  return { state, load, register, stop, reset };
}
