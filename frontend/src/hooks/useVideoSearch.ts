import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient, type ApiResult, type VideoSearchResult } from "@/api/client";
import { extractVideoId } from "@/lib/videoId";
import type { Video } from "@/types/video";

/**
 * 動画検索フック（U3 video-search / US3.1・FR3.1・C2）。
 * URL は video_id へ正規化して `apiClient.getVideo` で取得する。動画 ID の形の入力も同様に取得し、
 * 見つからなければタイトル・動画 ID の部分一致（`apiClient.searchVideos`）へ進む。それ以外の語と
 * 日付の絞り込みは最初から `apiClient.searchVideos` を使う。ID の完全一致を先に引くのは、検索用の
 * 複製（毎時同期）の遅れや障害に左右されず、登録直後の動画も見つけるため。
 *
 * レイヤ境界: hooks は api / lib / types のみに依存し、components には依存しない
 * （ViewState への変換は component 層が担う）。API 失敗の捕捉・分類は ApiClient 層に
 * 一元化済みで、ここは薄い取得アダプタに留める（try/catch を分散させず、ApiResult の
 * discriminated union を kind で分岐する。表示テキストで制御分岐しない）。
 */

/** 検索状態（discriminated union）。component 層はこれを ViewState へ橋渡しする。 */
export type VideoSearchState =
  | { kind: "idle" } // 未検索
  | { kind: "loading" } // 取得中
  | { kind: "ok"; videos: Video[]; hasMore: boolean } // 取得成功（1 件以上）
  | { kind: "notFound" } // 未存在（見つからない）
  | { kind: "invalidInput"; message: string } // 入力不正・空（API 非実行）
  | { kind: "error"; message: string }; // transport / 業務拒否など

/** 検索条件。日付は YYYY-MM-DD、未指定は空文字。 */
export interface VideoSearchInput {
  text: string;
  backupFrom?: string;
  backupTo?: string;
}

export interface VideoSearchController {
  /** 条件を検索する。条件がすべて空、または不正な URL は API を叩かず invalidInput にする。 */
  search: (input: VideoSearchInput) => void;
  /** 現在の検索状態。 */
  state: VideoSearchState;
  /** 取得中フラグ（=useQuery.isFetching）。 */
  isFetching: boolean;
  /** 現在の条件を再取得する（error 時の再試行に使う。未検索時は無処理）。 */
  refetch: () => void;
}

/** 検索の実行内容。`videoId` を先に引き、未存在なら `text` と日付で検索する。 */
interface SearchTarget {
  videoId: string | null;
  text: string | null;
  backupFrom: string;
  backupTo: string;
}

const TRANSPORT_MESSAGE = "通信に失敗しました。時間をおいて再試行してください。";
const INVALID_INPUT_MESSAGE = "タイトル、動画 ID、URL または日付を入力してください。";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 入力を検索内容へ変換する。何も検索できない入力は null。 */
function toSearchTarget({
  text,
  backupFrom = "",
  backupTo = "",
}: VideoSearchInput): SearchTarget | null {
  const trimmed = text.trim();
  const hasDate = backupFrom !== "" || backupTo !== "";
  // 「Re:ゼロ」のようなタイトルも URL として解釈できるため、http(s) だけを URL として扱う。
  if (/^https?:\/\//i.test(trimmed)) {
    const videoId = extractVideoId(trimmed);
    return videoId === null ? null : { videoId, text: null, backupFrom: "", backupTo: "" };
  }
  if (trimmed === "") {
    return hasDate ? { videoId: null, text: "", backupFrom, backupTo } : null;
  }
  const videoId = !hasDate && VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null;
  return { videoId, text: trimmed, backupFrom, backupTo };
}

async function findVideos(target: SearchTarget): Promise<ApiResult<VideoSearchResult>> {
  if (target.videoId !== null) {
    const result = await apiClient.getVideo(target.videoId);
    if (result.kind === "ok") {
      return { kind: "ok", data: { videos: [result.data], hasMore: false } };
    }
    if (result.kind !== "notFound" || target.text === null) {
      return result;
    }
  }
  return apiClient.searchVideos({
    query: target.text ?? "",
    backupFrom: target.backupFrom,
    backupTo: target.backupTo,
  });
}

export function useVideoSearch(): VideoSearchController {
  // submit 時のみ enabled にするための検索内容。未検索/空入力は null。
  const [target, setTarget] = useState<SearchTarget | null>(null);
  // 空/不正入力のクライアント検証エラー（API を叩かない）。
  const [validationError, setValidationError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["videoSearch", target],
    queryFn: () => {
      if (target === null) {
        // enabled=false のため到達しないが、silent failure にせず明示的に失敗させる。
        throw new Error("target is null");
      }
      return findVideos(target);
    },
    enabled: target !== null,
  });

  const search = useCallback((input: VideoSearchInput) => {
    const next = toSearchTarget(input);
    if (next === null) {
      // 空/不正入力: API を叩かずバリデーションエラーにする（US3.1）。
      setValidationError(INVALID_INPUT_MESSAGE);
      setTarget(null);
      return;
    }
    setValidationError(null);
    setTarget(next);
  }, []);

  const refetch = useCallback(() => {
    if (target !== null) {
      void query.refetch();
    }
  }, [target, query]);

  const state = useMemo<VideoSearchState>(() => {
    if (validationError !== null) {
      return { kind: "invalidInput", message: validationError };
    }
    if (target === null) {
      return { kind: "idle" };
    }
    if (query.isError) {
      return { kind: "error", message: TRANSPORT_MESSAGE };
    }
    if (query.data === undefined) {
      return { kind: "loading" };
    }
    const result = query.data;
    switch (result.kind) {
      case "ok":
        return { kind: "ok", ...result.data };
      case "empty":
      case "notFound":
        return { kind: "notFound" };
      case "invalidInput":
        return { kind: "invalidInput", message: result.message };
      case "transport":
        return { kind: "error", message: TRANSPORT_MESSAGE };
      case "rejected":
        return { kind: "error", message: result.message };
    }
  }, [validationError, target, query.isError, query.data]);

  return {
    search,
    state,
    isFetching: query.isFetching,
    refetch,
  };
}
