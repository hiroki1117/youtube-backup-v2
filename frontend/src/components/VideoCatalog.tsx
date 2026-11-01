import { Link, generatePath } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/PlatformIcon";
import { SourceLink } from "@/components/SourceLink";
import { StatusView } from "@/components/StatusView";
import { ROUTES } from "@/lib/routes";
import { highlightParts } from "@/lib/search";
import { cn } from "@/lib/utils";
import { REMOVE_LABEL, STATUS_LABEL, type Video } from "@/types/video";
import type { ViewState } from "@/types/viewState";

export interface VideoCatalogProps {
  state: ViewState<Video[]>;
  /** まだ続きがあるときだけ「もっと見る」を表示する。 */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onRetry?: () => void;
  /** 未指定なら行に削除ボタンを出さない。 */
  onDelete?: (video: Video) => void;
  loadingLabel?: string;
  /** リストの読み上げ名。 */
  listLabel?: string;
  /**
   * 検索結果として表示するときの語。タイトルの一致部分を強調し、見比べられるようタイトルを省略
   * しすぎない。
   */
  searchTerms?: string[];
}

function HighlightedTitle({ title, terms }: { title: string; terms: string[] }) {
  return highlightParts(title, terms).map((part, index) =>
    part.match ? (
      <mark key={index} className="rounded-xs bg-yellow-200 text-inherit dark:bg-yellow-500/35">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

export function VideoCatalog({
  state,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onRetry,
  onDelete,
  loadingLabel = "動画一覧を読み込んでいます...",
  listLabel = "動画一覧",
  searchTerms,
}: VideoCatalogProps) {
  return (
    <StatusView state={state} onRetry={onRetry} loadingLabel={loadingLabel}>
      {(videos) => (
        <div className="space-y-4">
          {/* スマホでは左右の余白も使ってタイトルの幅を確保する（docs/mobile-ui.md）。 */}
          <ul
            aria-label={listLabel}
            className="-mx-4 divide-y border-y md:mx-0 md:rounded-md md:border"
          >
            {videos.map((video) => (
              <li
                key={video.videoId}
                className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 px-4 py-3 md:flex md:items-center md:px-3"
                data-testid="video-row"
              >
                <span className="flex h-6 items-center md:h-auto" data-testid="video-platform">
                  <PlatformIcon platform={video.platform} />
                </span>
                <Link
                  to={generatePath(ROUTES.videoDetail, { videoId: video.videoId })}
                  // タッチ操作では ::after を行全体へ広げ、行のどこを押しても再生ページへ移れるようにする。
                  // 検索結果は見比べられるよう、PC でも 2 行まで表示する。
                  className={cn(
                    "min-w-0 font-medium hover:underline max-md:line-clamp-2 max-md:break-words md:flex-1 pointer-coarse:after:absolute pointer-coarse:after:inset-0",
                    searchTerms === undefined ? "md:truncate" : "md:line-clamp-2",
                  )}
                  // 長いタイトルは省略表示になるため、ホバーで全文を出す。
                  title={video.title}
                >
                  {searchTerms === undefined ? (
                    video.title
                  ) : (
                    <HighlightedTitle title={video.title} terms={searchTerms} />
                  )}
                </Link>
                {/* スマホではタイトルの下に置く。完了は一覧の既定の状態なので、処理中のときだけ出す。
                    md 以上は contents で行の中に横並びにする。 */}
                <div className="col-start-2 mt-0.5 flex items-center gap-2 md:mt-0 md:contents">
                  <span className="shrink-0 text-sm text-muted-foreground">{video.backupDate}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground",
                      video.uploadStatus === "complete" && "max-md:hidden",
                    )}
                  >
                    {STATUS_LABEL[video.uploadStatus]}
                  </span>
                </div>
                {/* 元サイト・削除はスマホでは再生ページで行う（誤タップで削除しないように）。 */}
                <div
                  className="relative z-10 hidden shrink-0 items-center gap-2 md:flex"
                  data-testid="video-row-extras"
                >
                  <SourceLink video={video} />
                  {onDelete ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(video)}
                      aria-label={`${REMOVE_LABEL[video.uploadStatus]}: ${video.title}`}
                    >
                      {REMOVE_LABEL[video.uploadStatus]}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && onLoadMore ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                className="max-md:w-full"
                onClick={onLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "読み込み中..." : "もっと見る"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </StatusView>
  );
}
