import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { CATALOG_PAGE_SIZE, paginate, sortVideos, type SortOrder } from "@/lib/catalog";
import type { UploadStatus, Video } from "@/types/video";

/**
 * カタログ取得フック（U2 video-catalog / US2.1・US2.2・US2.4・US2.5）。
 * ApiClient（唯一の HTTP 境界・型付き失敗値）から状態別一覧を取得し、
 * sortVideos → paginate を適用した「現在ページの表示行」と操作口を返す。
 *
 * レイヤ境界: hooks は api/lib/types のみに依存し、components には依存しない
 * （表示状態 ViewState への変換は app/component 層が担う）。API 失敗の捕捉・分類は
 * ApiClient 層に一元化済みで、ここは薄い取得アダプタに留める（try/catch を分散させない）。
 */

/** 既定フィルタ。API GSI 既定と同じ complete。 */
export const DEFAULT_UPLOAD_STATUS: UploadStatus = "complete";
/** 既定ソート順。API GSI（backupdate 降順）と同順。 */
export const DEFAULT_SORT_ORDER: SortOrder = "desc";
/**
 * 一覧の取得件数。初期表示の速さのため、API の既定順（backupdate 降順）で新しい側から取得する。
 * API はカーソルページング非対応（R-03）のため、これより古い動画は一覧に出ない（ID 検索では開ける）。
 * ソート／ページングは取得した件数の範囲でクライアントサイドに行う。
 */
export const CATALOG_FETCH_NUM = 50;

export interface VideoCatalogController {
  /** TanStack Query の取得状態。 */
  status: "pending" | "error" | "success";
  /** error 時の人間可読メッセージ（それ以外は null）。 */
  errorMessage: string | null;
  /** 現在ページの表示行（sort → paginate 済み）。 */
  items: Video[];
  /** 現在の uploadStatus における全件数（フィルタ適用後・ページ分割前）。 */
  total: number;
  /** [1, pageCount] にクランプ済みの実効ページ番号。 */
  page: number;
  pageCount: number;
  uploadStatus: UploadStatus;
  sortOrder: SortOrder;
  /** 再取得中フラグ（更新ボタンの二重押下防止に使う）。 */
  isFetching: boolean;
  /** 状態フィルタを切り替える（page は先頭へリセット）。 */
  setUploadStatus: (status: UploadStatus) => void;
  /** ソート順を設定する（page は先頭へリセット）。 */
  setSortOrder: (order: SortOrder) => void;
  /** ソート順を昇順/降順でトグルする（page は先頭へリセット）。 */
  toggleSortOrder: () => void;
  /** ページ番号を設定する（範囲外は paginate がクランプする）。 */
  setPage: (page: number) => void;
  /** 手動更新（US2.5）。 */
  refetch: () => void;
}

export function useVideoCatalog(): VideoCatalogController {
  const [uploadStatus, setUploadStatusState] = useState<UploadStatus>(DEFAULT_UPLOAD_STATUS);
  const [sortOrder, setSortOrderState] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [page, setPageState] = useState(1);

  const query = useQuery<Video[], Error>({
    // フィルタ（uploadStatus）はサーバー側パラメータ。切り替えで queryKey が変わり再取得される。
    queryKey: ["videos", uploadStatus],
    queryFn: async () => {
      const result = await apiClient.listVideos({ uploadStatus, fetchNum: CATALOG_FETCH_NUM });
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
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const sorted = useMemo(() => sortVideos(all, sortOrder), [all, sortOrder]);
  const { items, pageCount, page: safePage } = paginate(sorted, page, CATALOG_PAGE_SIZE);

  const setUploadStatus = useCallback((next: UploadStatus) => {
    setUploadStatusState(next);
    setPageState(1);
  }, []);

  const setSortOrder = useCallback((next: SortOrder) => {
    setSortOrderState(next);
    setPageState(1);
  }, []);

  const toggleSortOrder = useCallback(() => {
    setSortOrderState((prev) => (prev === "asc" ? "desc" : "asc"));
    setPageState(1);
  }, []);

  const setPage = useCallback((next: number) => {
    setPageState(next);
  }, []);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    status: query.status,
    errorMessage: query.error?.message ?? null,
    items,
    total: all.length,
    page: safePage,
    pageCount,
    uploadStatus,
    sortOrder,
    isFetching: query.isFetching,
    setUploadStatus,
    setSortOrder,
    toggleSortOrder,
    setPage,
    refetch,
  };
}
