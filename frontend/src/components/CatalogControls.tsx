import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SortOrder } from "@/lib/catalog";
import type { UploadStatus } from "@/types/video";

/**
 * 一覧操作コントロール（presentational / U2）。
 * 状態フィルタ切替（US2.2）・ソート順トグル（US2.3）・手動更新（US2.5）。
 * role/aria を付与し、制御フローは enum（UploadStatus / SortOrder）で分岐する
 * （表示テキスト＝ラベルでは分岐しない）。副作用は持たず、操作はコールバックで親へ委譲する。
 */

export interface CatalogControlsProps {
  uploadStatus: UploadStatus;
  sortOrder: SortOrder;
  onFilterChange: (status: UploadStatus) => void;
  onSortToggle: () => void;
  onRefresh: () => void;
  /** 再取得中は更新ボタンを無効化する。 */
  isFetching: boolean;
}

// enum → 表示ラベル（分岐には使わない）。
const FILTER_OPTIONS: UploadStatus[] = ["complete", "init"];
const FILTER_LABEL: Record<UploadStatus, string> = {
  complete: "完了",
  init: "処理中",
};
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
            {FILTER_LABEL[option]}
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
