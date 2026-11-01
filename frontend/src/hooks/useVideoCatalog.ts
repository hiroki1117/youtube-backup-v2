import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { sortVideos, type SortOrder } from "@/lib/catalog";
import type { UploadStatus, Video } from "@/types/video";

export const DEFAULT_UPLOAD_STATUS: UploadStatus = "complete";
// API はカーソルページング非対応なので、「もっと見る」は取得件数を増やして先頭から取り直す。
export const CATALOG_FETCH_NUM = 50;
export const CATALOG_FETCH_STEP = 50;
/** API の `fetch_num` の上限。これより古い動画は一覧に出ない（ID 検索では開ける）。 */
export const CATALOG_FETCH_MAX = 1000;

async function fetchVideos(uploadStatus: UploadStatus, fetchNum: number): Promise<Video[]> {
  const result = await apiClient.listVideos({ uploadStatus, fetchNum });
  if (result.kind !== "ok") {
    throw new Error(result.message);
  }
  return result.data;
}

export function useVideoCatalog() {
  const queryClient = useQueryClient();
  const [uploadStatus, setUploadStatusState] = useState(DEFAULT_UPLOAD_STATUS);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [fetchNum, setFetchNum] = useState(CATALOG_FETCH_NUM);

  const query = useQuery({
    queryKey: ["videos", uploadStatus, fetchNum],
    queryFn: () => fetchVideos(uploadStatus, fetchNum),
    // 件数を増やす間は同じフィルタの取得済み行を表示し続ける（フィルタが変わったときは引き継がない）。
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === uploadStatus ? previousData : undefined,
  });

  // 表示中の一覧が取れたら、もう一方の状態の先頭ページを裏で先読みする（切り替えを即表示するため）。
  const otherStatus: UploadStatus = uploadStatus === "complete" ? "init" : "complete";
  const isSuccess = query.status === "success";
  useEffect(() => {
    if (isSuccess) {
      void queryClient.prefetchQuery({
        queryKey: ["videos", otherStatus, CATALOG_FETCH_NUM],
        queryFn: () => fetchVideos(otherStatus, CATALOG_FETCH_NUM),
      });
    }
  }, [isSuccess, otherStatus, queryClient]);

  const items = useMemo(() => sortVideos(query.data ?? [], sortOrder), [query.data, sortOrder]);

  // placeholder 表示中は増分前の件数で判定し、ボタンを消さない。
  const requested = query.isPlaceholderData ? fetchNum - CATALOG_FETCH_STEP : fetchNum;

  return {
    status: query.status,
    errorMessage: query.error?.message ?? "",
    items,
    hasMore: query.data !== undefined && items.length >= requested && requested < CATALOG_FETCH_MAX,
    uploadStatus,
    sortOrder,
    isFetching: query.isFetching,
    setUploadStatus: (next: UploadStatus) => {
      setUploadStatusState(next);
      setFetchNum(CATALOG_FETCH_NUM);
    },
    toggleSortOrder: () => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc")),
    loadMore: () => setFetchNum((prev) => Math.min(prev + CATALOG_FETCH_STEP, CATALOG_FETCH_MAX)),
    refetch: () => void query.refetch(),
  };
}
