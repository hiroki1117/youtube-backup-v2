import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SortOrder } from "@/lib/catalog";
import { STATUS_LABEL } from "@/lib/videoLabels";
import type { UploadStatus } from "@/types/video";

export interface CatalogControlsProps {
  uploadStatus: UploadStatus;
  sortOrder: SortOrder;
  onFilterChange: (status: UploadStatus) => void;
  onSortToggle: () => void;
  onRefresh: () => void;
  isFetching: boolean;
}

const FILTER_OPTIONS: UploadStatus[] = ["complete", "init"];
const SORT_LABEL: Record<SortOrder, string> = {
  desc: "新しい順",
  asc: "古い順",
};

export function CatalogControls({
  uploadStatus,
  sortOrder,
  onFilterChange,
  onSortToggle,
  onRefresh,
  isFetching,
}: CatalogControlsProps) {
  return (
    <div className="flex items-center gap-2 md:justify-between md:gap-3">
      {/* スマホではフィルタを残りの幅いっぱいに広げ、親指で切り替えやすくする。 */}
      <div
        role="group"
        aria-label="状態フィルタ"
        className="grid min-w-0 flex-1 grid-cols-2 gap-1 md:flex md:flex-none md:items-center"
      >
        {FILTER_OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            variant={uploadStatus === option ? "default" : "outline"}
            size="sm"
            aria-pressed={uploadStatus === option}
            onClick={() => onFilterChange(option)}
          >
            {STATUS_LABEL[option]}
          </Button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`並び順を切り替え（現在: ${SORT_LABEL[sortOrder]}）`}
          onClick={onSortToggle}
        >
          {SORT_LABEL[sortOrder]}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="一覧を更新"
          onClick={onRefresh}
          disabled={isFetching}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">更新</span>
        </Button>
      </div>
    </div>
  );
}
