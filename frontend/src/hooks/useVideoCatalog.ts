import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { sortVideos, type SortOrder } from "@/lib/catalog";
import type { UploadStatus, Video } from "@/types/video";

/**
 * カタログ取得フック（U2 video-catalog / US2.1・US2.2・US2.3・US2.5）。
 * ApiClient（唯一の HTTP 境界・型付き失敗値）から状態別一覧を取得し、sortVideos を適用した
 * 「取得済みの全行」と操作口を返す。
 *
 * 続きの読み込みは「more」方式: API はカーソルページング非対応のため、
 * 「もっと見る」で取得件数（fetch_num）を一定数ずつ増やして先頭から取り直す。
 *
 * レイヤ境界: hooks は api/lib/types のみに依存し、components には依存しない
 * （表示状態 ViewState への変換は app/component 層が担う）。API 失敗の捕捉・分類は
 * ApiClient 層に一元化済みで、ここは薄い取得アダプタに留める（try/catch を分散させない）。
 */

/** 既定フィルタ。API GSI 既定と同じ complete。 */
export const DEFAULT_UPLOAD_STATUS: UploadStatus = "complete";
/** 既定ソート順。API GSI（backupdate 降順）と同順。 */
export const DEFAULT_SORT_ORDER: SortOrder = "desc";
/** 初期表示の取得件数。API の既定順（backupdate 降順）で新しい側から取得する。 */
export const CATALOG_FETCH_NUM = 50;
/** 「もっと見る」1 回あたりの増分。 */
export const CATALOG_FETCH_STEP = 50;
/** 取得件数の上限（API の `fetch_num` 上限と一致）。これより古い動画は一覧に出ない（ID 検索では開ける）。 */
export const CATALOG_FETCH_MAX = 1000;

export interface VideoCatalogController {
  /** TanStack Query の取得状態。 */
  status: "pending" | "error" | "success";
  /** error 時の人間可読メッセージ（それ以外は null）。 */
  errorMessage: string | null;
  /** 取得済みの全行（sort 済み）。 */
  items: Video[];
  /** 取得済みの件数（フィルタ適用後）。 */
  total: number;
  /** まだ続きがある（取得件数の上限に達しておらず、要求した件数を満たした）。 */
  hasMore: boolean;
  uploadStatus: UploadStatus;
  sortOrder: SortOrder;
  /** 再取得中フラグ（更新ボタン・もっと見るの二重押下防止に使う）。 */
  isFetching: boolean;
  /** 状態フィルタを切り替える（取得件数は初期値へ戻す）。 */
  setUploadStatus: (status: UploadStatus) => void;
  /** ソート順を設定する。 */
  setSortOrder: (order: SortOrder) => void;
  /** ソート順を昇順/降順でトグルする。 */
  toggleSortOrder: () => void;
  /** 取得件数を増やして続きを読み込む（「もっと見る」）。 */
  loadMore: () => void;
  /** 手動更新（US2.5）。 */
  refetch: () => void;
}

export function useVideoCatalog(): VideoCatalogController {
  const [uploadStatus, setUploadStatusState] = useState<UploadStatus>(DEFAULT_UPLOAD_STATUS);
  const [sortOrder, setSortOrderState] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [fetchNum, setFetchNum] = useState(CATALOG_FETCH_NUM);

  const query = useQuery<Video[], Error>({
    // フィルタ（uploadStatus）と取得件数はサーバー側パラメータ。変わると queryKey が変わり再取得される。
    queryKey: ["videos", uploadStatus, fetchNum],
    queryFn: async () => {
      const result = await apiClient.listVideos({ uploadStatus, fetchNum });
      switch (result.kind) {
        case "ok":
          return result.data;
        case "empty":
          return [];
        default:
          // ApiClient が正規化した失敗値を Query の error セマンティクスへ橋渡しする（FR8）。
          throw new Error(result.message);
      }
    },
    // 件数を増やす間は同じフィルタの取得済み行を表示し続ける（フィルタが変わったときは引き継がない）。
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === uploadStatus ? previousData : undefined,
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const items = useMemo(() => sortVideos(all, sortOrder), [all, sortOrder]);

  // placeholder 表示中は前回（増分前）の件数で「続きがあるか」を判定し、ボタンを消さない。
  const requested = query.isPlaceholderData ? fetchNum - CATALOG_FETCH_STEP : fetchNum;
  const hasMore =
    query.data !== undefined && all.length >= requested && requested < CATALOG_FETCH_MAX;

  const setUploadStatus = useCallback((next: UploadStatus) => {
    setUploadStatusState(next);
    setFetchNum(CATALOG_FETCH_NUM);
  }, []);

  const setSortOrder = useCallback((next: SortOrder) => {
    setSortOrderState(next);
  }, []);

  const toggleSortOrder = useCallback(() => {
    setSortOrderState((prev) => (prev === "asc" ? "desc" : "asc"));
  }, []);

  const loadMore = useCallback(() => {
    setFetchNum((prev) => Math.min(prev + CATALOG_FETCH_STEP, CATALOG_FETCH_MAX));
  }, []);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    status: query.status,
    errorMessage: query.error?.message ?? null,
    items,
    total: all.length,
    hasMore,
    uploadStatus,
    sortOrder,
    isFetching: query.isFetching,
    setUploadStatus,
    setSortOrder,
    toggleSortOrder,
    loadMore,
    refetch,
  };
}
