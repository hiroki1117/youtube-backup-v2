import { CatalogControls } from "@/components/CatalogControls";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { VideoCatalog } from "@/components/VideoCatalog";
import { DEFAULT_UPLOAD_STATUS, useVideoCatalog } from "@/hooks/useVideoCatalog";
import { useVideoDeletion } from "@/hooks/useVideoDeletion";
import type { Video } from "@/types/video";
import type { ViewState } from "@/types/viewState";

function toViewState(catalog: ReturnType<typeof useVideoCatalog>): ViewState<Video[]> {
  switch (catalog.status) {
    case "pending":
      return { status: "loading" };
    case "error":
      return { status: "error", message: catalog.errorMessage };
    case "success":
      if (catalog.items.length > 0) {
        return { status: "ready", data: catalog.items };
      }
      return {
        status: "empty",
        message:
          catalog.uploadStatus === DEFAULT_UPLOAD_STATUS
            ? "バックアップ済み動画がありません"
            : "条件に一致するデータがありません",
      };
  }
}

export function VideosPage() {
  const catalog = useVideoCatalog();
  const deletion = useVideoDeletion();

  return (
    <section aria-label="動画一覧" className="space-y-4">
      {/* スマホでは一覧を広く見せるため、見出しは読み上げだけに残す。 */}
      <h2 className="sr-only text-xl font-semibold md:not-sr-only">動画一覧</h2>
      <CatalogControls
        uploadStatus={catalog.uploadStatus}
        sortOrder={catalog.sortOrder}
        onFilterChange={catalog.setUploadStatus}
        onSortToggle={catalog.toggleSortOrder}
        onRefresh={catalog.refetch}
        isFetching={catalog.isFetching}
      />
      <VideoCatalog
        state={toViewState(catalog)}
        hasMore={catalog.hasMore}
        onLoadMore={catalog.loadMore}
        isLoadingMore={catalog.isFetching}
        onRetry={catalog.refetch}
        onDelete={deletion.requestDelete}
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
