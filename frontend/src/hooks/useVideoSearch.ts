import { useMemo } from "react";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { apiClient, apiErrorMessage, type ApiResult, type VideoSearchResult } from "@/api/client";
import { hasConditions, isUrlText, type SearchFilters } from "@/lib/search";
import { extractVideoId } from "@/lib/videoId";
import type { Video } from "@/types/video";

/**
 * 動画検索。URL は video_id へ正規化して `getVideo` で取得する。動画 ID の形の入力も同様に取得し、
 * 見つからなければ部分一致の `searchVideos` へ進む。それ以外の語と日付の絞り込みは最初から
 * `searchVideos` を使う。ID の完全一致を先に引くのは、検索用の複製（毎時同期）の遅れや障害に
 * 左右されず、登録直後の動画も見つけるため。
 */
export type VideoSearchState =
  | { kind: "idle" } // 条件なし
  | { kind: "loading" }
  | { kind: "ok"; videos: Video[]; hasMore: boolean } // 1 件以上
  | { kind: "notFound" }
  | { kind: "invalidInput"; message: string }
  | { kind: "error"; message: string };

/** `videoId` を先に引き、未存在なら `text` と日付で検索する。 */
interface SearchTarget {
  videoId: string | null;
  text: string | null;
  from: string;
  to: string;
}

const INVALID_URL_MESSAGE = "この URL から動画 ID を特定できませんでした。";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// 1 回の検索で取得する上限（API の最大値）。続きは API にないので、超えたら条件を絞ってもらう。
const SEARCH_LIMIT = 100;

/** 条件を検索内容へ変換する。検索できない URL は null。 */
function toSearchTarget({ text, from, to }: SearchFilters): SearchTarget | null {
  const trimmed = text.trim();
  if (isUrlText(trimmed)) {
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

function toSearchState(result: ApiResult<VideoSearchResult> | undefined): VideoSearchState {
  if (result === undefined) {
    return { kind: "loading" };
  }
  switch (result.kind) {
    case "ok":
      return result.data.videos.length === 0
        ? { kind: "notFound" }
        : { kind: "ok", ...result.data };
    case "notFound":
      return { kind: "notFound" };
    case "invalidInput":
      return { kind: "invalidInput", message: result.message };
    default:
      return { kind: "error", message: apiErrorMessage(result) };
  }
}

export function useVideoSearch(filters: SearchFilters) {
  const searchable = hasConditions(filters);
  const target = useMemo(
    () => (searchable ? toSearchTarget(filters) : null),
    [searchable, filters],
  );

  const query = useQuery({
    queryKey: ["videoSearch", target],
    queryFn: target === null ? skipToken : () => findVideos(target),
    // 条件を変えた瞬間に結果を消さない（Neon の起動待ちで数秒かかることがあるため）。
    placeholderData: keepPreviousData,
  });

  let state: VideoSearchState;
  if (!searchable) {
    state = { kind: "idle" };
  } else if (target === null) {
    state = { kind: "invalidInput", message: INVALID_URL_MESSAGE };
  } else {
    state = toSearchState(query.data);
  }

  return { state, isFetching: query.isFetching, refetch: () => void query.refetch() };
}
