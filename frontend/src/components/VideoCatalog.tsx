import { Link, generatePath } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/PlatformIcon";
import { SourceLink } from "@/components/SourceLink";
import { StatusView, type ViewState } from "@/components/StatusView";
import { ROUTES } from "@/lib/routes";
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
export function VideoCatalog({
  state,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onRetry,
  handlers,
}: VideoCatalogProps) {
  const { onDelete } = handlers ?? {};
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
                className="flex items-center gap-2 p-3"
                data-testid="video-row"
              >
                <span className="flex items-center" data-testid="video-platform">
                  <PlatformIcon platform={video.platform} />
                </span>
                <Link
                  to={generatePath(ROUTES.videoDetail, { videoId: video.videoId })}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                  // 長いタイトルは省略表示になるため、ホバーで全文を出す。
                  title={video.title}
                >
                  {video.title}
                </Link>
                {/* スマホ幅ではタイトルを読めるよう、アイコンとタイトル以外は出さない。
                    日付・状態・元サイト・削除は再生ページ（詳細）でも見られる・行える。 */}
                <div
                  className="hidden shrink-0 items-center gap-2 md:flex"
                  data-testid="video-row-extras"
                >
                  <span className="text-sm text-muted-foreground">{video.backupDate}</span>
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {STATUS_LABEL[video.uploadStatus]}
                  </span>
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
