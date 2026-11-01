import { CatalogControls } from "@/components/CatalogControls";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { VideoCatalog } from "@/components/VideoCatalog";
import { useVideoCatalog } from "@/hooks/useVideoCatalog";
import { useVideoDeletion } from "@/hooks/useVideoDeletion";

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
        state={catalog.state}
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
