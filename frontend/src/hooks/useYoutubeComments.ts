import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient, apiErrorMessage } from "@/api/client";
import type { ViewState } from "@/types/viewState";
import type { YoutubeCommentThread } from "@/types/youtubeComments";

const PAGE_SIZE = 20;
const TRANSPORT_MESSAGE = "コメントを読み込めませんでした。時間をおいて再試行してください。";

export interface YoutubeCommentList {
  threads: YoutubeCommentThread[];
  totalThreads: number;
  totalComments: number;
}

/**
 * スレッド単位のページを「もっと見る」で継ぎ足す。
 * @param completedAt 直近に完了した取得の時刻。変わったら（再取得が完了したら）最初から読み直す
 */
export function useYoutubeComments(videoId: string, completedAt: number | null, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["youtubeComments", videoId, completedAt],
    queryFn: async ({ pageParam }) => {
      const result = await apiClient.getYoutubeComments(videoId, {
        offset: pageParam,
        limit: PAGE_SIZE,
      });
      if (result.kind !== "ok") {
        throw new Error(apiErrorMessage(result, TRANSPORT_MESSAGE));
      }
      return result.data;
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: enabled && completedAt !== null,
  });

  let state: ViewState<YoutubeCommentList> = { status: "loading" };
  if (query.data !== undefined) {
    const pages = query.data.pages;
    const { totalThreads, totalComments } = pages[pages.length - 1];
    const threads = pages.flatMap((page) => page.threads);
    state = { status: "ready", data: { threads, totalThreads, totalComments } };
  } else if (query.error) {
    state = { status: "error", message: query.error.message };
  }

  return {
    state,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}
