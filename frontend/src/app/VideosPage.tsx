import { generatePath, useNavigate } from "react-router-dom";
import { CatalogControls } from "@/components/CatalogControls";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { ViewState } from "@/components/StatusView";
import { VideoCatalog } from "@/components/VideoCatalog";
import {
  DEFAULT_UPLOAD_STATUS,
  useVideoCatalog,
  type VideoCatalogController,
} from "@/hooks/useVideoCatalog";
import { useVideoDeletion } from "@/hooks/useVideoDeletion";
import { useVideoDownload } from "@/hooks/useVideoDownload";
import { ROUTES } from "@/lib/routes";
import type { Video } from "@/types/video";

/**
 * 状態別動画一覧ページ（U2 video-catalog + U5 video-deletion / US2.1〜US2.5・US5.1 / FR2.1〜2.4・FR5.1 / FR8）。
 * useVideoCatalog（取得 + sort + もっと見る）を CatalogControls（フィルタ/ソート/更新）と
 * VideoCatalog（状態別描画 + 行アクション起動口）へ接続する。
 *
 * 行アクション（C6 RowActionHandlers）の onDelete に useVideoDeletion.requestDelete を配線し（U5）、
 * DeleteConfirmDialog で削除前確認を行う（FR5.1）。onPlay は再生ページ（/videos/:videoId）へ遷移し、
 * onDownload は complete 動画のダウンロード（useVideoDownload）を起動する（U6 / US6.1・US6.2・C6）。
 * StatusView（C4）で loading/error/empty を統一描画する。
 */

// 取得状態を UiStateKit の ViewState へ変換する（app 層の責務。hooks は ViewState に依存しない）。
// 空表示は、既定フィルタ（complete）で 0 件 → nodata、フィルタ適用（init）で 0 件 → filtered。
function deriveCatalogState(catalog: VideoCatalogController): ViewState<Video[]> {
  switch (catalog.status) {
    case "pending":
      return { status: "loading" };
    case "error":
      return { status: "error", message: catalog.errorMessage ?? "動画一覧の取得に失敗しました" };
    case "success":
      if (catalog.total === 0) {
        return {
          status: "empty",
          variant: catalog.uploadStatus === DEFAULT_UPLOAD_STATUS ? "nodata" : "filtered",
        };
      }
      return { status: "ready", data: catalog.items };
  }
}

export function VideosPage() {
  const catalog = useVideoCatalog();
  const deletion = useVideoDeletion();
  const download = useVideoDownload();
  const navigate = useNavigate();
  const state = deriveCatalogState(catalog);

  return (
    <section aria-label="動画一覧" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">動画一覧</h2>
      </div>
      <CatalogControls
        uploadStatus={catalog.uploadStatus}
        sortOrder={catalog.sortOrder}
        onFilterChange={catalog.setUploadStatus}
        onSortToggle={catalog.toggleSortOrder}
        onRefresh={catalog.refetch}
        isFetching={catalog.isFetching}
      />
      <VideoCatalog
        state={state}
        hasMore={catalog.hasMore}
        onLoadMore={catalog.loadMore}
        isLoadingMore={catalog.isFetching}
        onRetry={catalog.refetch}
        // 行アクションを配線（C6）: onDelete=U5 削除フロー、onPlay=再生ページ遷移、
        // onDownload=U6 ダウンロード（VideoCatalog は complete 行にのみ DL ボタンを描画。hook 側も A3 ガード）。
        handlers={{
          onDelete: deletion.requestDelete,
          onPlay: (video) => navigate(generatePath(ROUTES.videoDetail, { videoId: video.videoId })),
          onDownload: (video) => download.download(video),
        }}
      />
      <DeleteConfirmDialog
        video={deletion.pendingVideo}
        isDeleting={deletion.isDeleting}
        onConfirm={deletion.confirmDelete}
        onCancel={deletion.cancelDelete}
      />
    </section>
  );
}
