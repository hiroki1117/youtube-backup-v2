import { Link, generatePath } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/PlatformIcon";
import { SourceLink } from "@/components/SourceLink";
import { StatusView, type ViewState } from "@/components/StatusView";
import { ROUTES, type SearchReturnState } from "@/lib/routes";
import { highlightParts } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { UploadStatus, Video } from "@/types/video";

/**
 * VideoCatalog 行アクション契約（contract C6。Owner: VideoCatalog (U2)）。
 * 一覧行の削除（U5）をコールバックで受け取る起動口。ハンドラにはその行の Video を渡し、
 * 未提供（undefined）のアクションは行に表示しない。
 * 再生・ダウンロードは行に置かず、タイトルのリンクから再生ページ（U6）へ移って行う。
 */
export interface RowActionHandlers {
  onDelete?(video: Video): void;
}

export interface VideoCatalogProps {
  /** UiStateKit の表示状態（ready.data = 現在ページの表示行）。 */
  state: ViewState<Video[]>;
  /** まだ続きがあるときだけ「もっと見る」を表示する。 */
  hasMore?: boolean;
  /** 「もっと見る」の押下（取得件数を増やして続きを読み込む）。 */
  onLoadMore?: () => void;
  /** 続きの読み込み中（ボタンを無効化して二重押下を防ぐ）。 */
  isLoadingMore?: boolean;
  /** error 時の再取得口（C4）。 */
  onRetry?: () => void;
  /** 行アクション起動口（C6）。未提供のアクションはボタンを描画しない。 */
  handlers?: RowActionHandlers;
  /** 読み込み中の文言。 */
  loadingLabel?: string;
  /** リストの読み上げ名。 */
  listLabel?: string;
  /**
   * 検索結果として表示するときの語。タイトルの一致部分を強調し、見比べられるようタイトルを省略
   * しすぎない。
   */
  searchTerms?: string[];
  /** 検索結果として表示するときの戻り先。再生ページの戻るリンクが使う。 */
  searchReturn?: SearchReturnState;
}

// upload_status enum → 表示ラベル。制御フローは enum で分岐し、ラベルでは分岐しない。
const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
};

// 行の onDelete ボタンのラベル。処理中（init）の動画に対する削除は、バックアップの取り消しになる。
const REMOVE_LABEL: Record<UploadStatus, string> = {
  init: "取り消し",
  complete: "削除",
};

// 空表示の文言を variant（enum）で出し分ける。
// nodata: 全件 0（データが存在しない） / filtered: フィルタ結果 0（FR8）。
const EMPTY_MESSAGE: Record<"nodata" | "filtered", string> = {
  nodata: "バックアップ済み動画がありません",
  filtered: "条件に一致するデータがありません",
};

/**
 * 状態別動画一覧の表示（presentational）。副作用・API 依存を持たない。
 * loading/error(+retry)/empty(nodata|filtered)/ready を StatusView で統一描画し、
 * ready 時は行リスト + ページ送りを描画する。タイトルは再生ページ（/videos/:videoId）へのリンク。
 * (US2.1〜US2.4 / FR8 / C4 / C6)
 */
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
  handlers,
  loadingLabel = "動画一覧を読み込んでいます...",
  listLabel = "動画一覧",
  searchTerms,
  searchReturn,
}: VideoCatalogProps) {
  const { onDelete } = handlers ?? {};
  const emptyMessage = state.status === "empty" ? EMPTY_MESSAGE[state.variant] : undefined;

  return (
    <StatusView
      state={state}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      loadingLabel={loadingLabel}
    >
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
                  state={searchReturn}
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
