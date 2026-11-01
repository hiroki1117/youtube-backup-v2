import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient, type ApiResult, type VideoSearchResult } from "@/api/client";
import { hasConditions, type SearchFilters } from "@/lib/search";
import { extractVideoId } from "@/lib/videoId";
import type { Video } from "@/types/video";

/**
 * 動画検索フック（U3 video-search / US3.1・FR3.1・C2）。条件は URL が持ち、ここは受け取った
 * 条件を取得するだけの薄いアダプタに留める。
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

/** 検索状態（discriminated union）。component 層はこれを表示へ橋渡しする。 */
export type VideoSearchState =
  | { kind: "idle" } // 条件なし
  | { kind: "loading" } // 取得中
  | { kind: "ok"; videos: Video[]; hasMore: boolean } // 取得成功（1 件以上）
  | { kind: "notFound" } // 該当なし
  | { kind: "invalidInput"; message: string } // 入力不正（API 非実行、またはサーバーの検証）
  | { kind: "error"; message: string }; // transport / 業務拒否など

export interface VideoSearchController {
  /** 現在の検索状態。条件が変わる間は直前の結果を保つ。 */
  state: VideoSearchState;
  /** 取得中フラグ（=useQuery.isFetching）。 */
  isFetching: boolean;
  /** 現在の条件を再取得する（error 時の再試行に使う）。 */
  refetch: () => void;
}

/** 検索の実行内容。`videoId` を先に引き、未存在なら `text` と日付で検索する。 */
interface SearchTarget {
  videoId: string | null;
  text: string | null;
  from: string;
  to: string;
}

const TRANSPORT_MESSAGE = "通信に失敗しました。時間をおいて再試行してください。";
const INVALID_URL_MESSAGE = "この URL から動画 ID を特定できませんでした。";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// 1 回の検索で取得する上限（API の最大値）。続きは API にないので、超えたら条件を絞ってもらう。
const SEARCH_LIMIT = 100;

/** 条件を検索内容へ変換する。検索できない URL は null。 */
function toSearchTarget({ text, from, to }: SearchFilters): SearchTarget | null {
  const trimmed = text.trim();
  // 「Re:ゼロ」のようなタイトルも URL として解釈できるため、http(s) だけを URL として扱う。
  if (/^https?:\/\//i.test(trimmed)) {
    const videoId = extractVideoId(trimmed);
    return videoId === null ? null : { videoId, text: null, from: "", to: "" };
  }
  const hasDate = from !== "" || to !== "";
  const videoId = !hasDate && VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null;
  return { videoId, text: trimmed, from, to };
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
    backupFrom: target.from,
    backupTo: target.to,
    limit: SEARCH_LIMIT,
  });
}

export function useVideoSearch(filters: SearchFilters): VideoSearchController {
  const searchable = hasConditions(filters);
  const target = useMemo(
    () => (searchable ? toSearchTarget(filters) : null),
    [searchable, filters],
  );

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
    // 条件を変えた瞬間に結果を消さない（Neon の起動待ちで数秒かかることがあるため）。
    placeholderData: keepPreviousData,
  });

  const state = useMemo<VideoSearchState>(() => {
    if (!searchable) {
      return { kind: "idle" };
    }
    if (target === null) {
      return { kind: "invalidInput", message: INVALID_URL_MESSAGE };
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
  }, [searchable, target, query.isError, query.data]);

  return {
    state,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
