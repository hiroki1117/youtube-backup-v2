import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/PlatformIcon";
import { SourceLink } from "@/components/SourceLink";
import { StatusView, type ViewState } from "@/components/StatusView";
import type { UploadStatus, Video } from "@/types/video";

/**
 * VideoCatalog 行アクション契約（contract C6。Owner: VideoCatalog (U2)）。
 * 一覧行の削除（U5）・再生/DL（U6）をコールバックで受け取る起動口。
 * 各ハンドラにはその行の Video を渡す。未提供（undefined）のアクションは行に表示しない。
 * ダウンロードは complete のみ提供する（init は S3 未確定のため）。
 */
export interface RowActionHandlers {
  onDelete?(video: Video): void;
  onPlay?(video: Video): void;
  onDownload?(video: Video): void;
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
}

// upload_status enum → 表示ラベル。制御フローは enum で分岐し、ラベルでは分岐しない。
const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
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
 * ready 時は行リスト + ページ送りを描画する。(US2.1〜US2.4 / FR8 / C4 / C6)
 */
export function VideoCatalog({
  state,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onRetry,
  handlers,
}: VideoCatalogProps) {
  const { onDelete, onPlay, onDownload } = handlers ?? {};
  const emptyMessage = state.status === "empty" ? EMPTY_MESSAGE[state.variant] : undefined;

  return (
    <StatusView
      state={state}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      loadingLabel="動画一覧を読み込んでいます..."
    >
      {(videos) => (
        <div className="space-y-4">
          <ul aria-label="動画一覧" className="divide-y rounded-md border">
            {videos.map((video) => (
              <li
                key={video.videoId}
                className="flex flex-wrap items-center gap-2 p-3"
                data-testid="video-row"
              >
                <span className="flex items-center" data-testid="video-platform">
                  <PlatformIcon platform={video.platform} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{video.title}</span>
                <span className="text-sm text-muted-foreground">{video.backupDate}</span>
                <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                  {STATUS_LABEL[video.uploadStatus]}
                </span>
                <SourceLink video={video} />
                {onPlay || onDownload || onDelete ? (
                  <span className="flex items-center gap-1">
                    {onPlay ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPlay(video)}
                        aria-label={`再生: ${video.title}`}
                      >
                        再生
                      </Button>
                    ) : null}
                    {onDownload && video.uploadStatus === "complete" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownload(video)}
                        aria-label={`ダウンロード: ${video.title}`}
                      >
                        ダウンロード
                      </Button>
                    ) : null}
                    {onDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(video)}
                        aria-label={`削除: ${video.title}`}
                      >
                        削除
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {hasMore && onLoadMore ? (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "読み込み中..." : "もっと見る"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </StatusView>
  );
}
