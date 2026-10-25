import { useMemo } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { apiClient, type ApiResult } from "@/api/client";
import type { YoutubeCommentPage, YoutubeCommentThread } from "@/types/youtubeComments";

/**
 * バックアップした YouTube コメントの一覧フック（`GET /videos/{id}/comments/items`）。
 * スレッド単位のページを「もっと見る」で継ぎ足す。取得の完了時刻（`completedAt`）をキーに含め、
 * 再取得が完了したら一覧を最初から読み直す。ApiResult は kind で判別する。
 */

/** 1 回に読み込むスレッド数。 */
export const YOUTUBE_COMMENTS_PAGE_SIZE = 20;

export type YoutubeCommentsView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      threads: YoutubeCommentThread[];
      totalThreads: number;
      totalComments: number;
    };

export interface YoutubeCommentsController {
  state: YoutubeCommentsView;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

const TRANSPORT_MESSAGE = "コメントを読み込めませんでした。時間をおいて再試行してください。";

/** ApiResult の失敗は reject に変える（useInfiniteQuery の error 状態で扱うため）。 */
class CommentsLoadError extends Error {}

/**
 * @param videoId 対象の動画
 * @param completedAt 直近に完了した取得の時刻（変わったら読み直す）
 * @param enabled 読み込むか
 */
export function useYoutubeComments(
  videoId: string,
  completedAt: number | null,
  enabled: boolean,
): YoutubeCommentsController {
  const query = useInfiniteQuery<
    YoutubeCommentPage,
    Error,
    InfiniteData<YoutubeCommentPage, number>,
    (string | number | null)[],
    number
  >({
    queryKey: ["youtubeComments", videoId, completedAt],
    queryFn: async ({ pageParam }) => {
      const result: ApiResult<YoutubeCommentPage> = await apiClient.getYoutubeComments(videoId, {
        offset: pageParam,
        limit: YOUTUBE_COMMENTS_PAGE_SIZE,
      });
      if (result.kind !== "ok") {
        throw new CommentsLoadError(
          result.kind === "transport" || result.kind === "empty"
            ? TRANSPORT_MESSAGE
            : result.message,
        );
      }
      return result.data;
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: enabled && completedAt !== null,
  });

  const state = useMemo<YoutubeCommentsView>(() => {
    if (query.data === undefined) {
      if (query.error) {
        const message =
          query.error instanceof CommentsLoadError ? query.error.message : TRANSPORT_MESSAGE;
        return { kind: "error", message };
      }
      return { kind: "loading" };
    }
    const pages = query.data.pages;
    const last = pages[pages.length - 1];
    return {
      kind: "ready",
      threads: pages.flatMap((p) => p.threads),
      totalThreads: last.totalThreads,
      totalComments: last.totalComments,
    };
  }, [query.data, query.error]);

  return {
    state,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}
