import { useState, type FormEvent } from "react";
import { generatePath, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusView, type ViewState } from "@/components/StatusView";
import { useVideoSearch, type VideoSearchState } from "@/hooks/useVideoSearch";
import { ROUTES } from "@/lib/routes";
import type { UploadStatus, Video } from "@/types/video";

/**
 * 動画検索ダイアログ（U3 video-search / US3.1・FR3.1・C4・C5・OQ-C2）。
 * 入力（タイトル / video_id / URL / バックアップ日）→ 検索フック（useVideoSearch）→ 結果を
 * StatusView（C4）で描画する。ready 時は該当する動画の一覧を表示し、`uploadStatus === "complete"` のときのみ「再生ページへ」ナビゲーション
 * （ROUTES.videoDetail = /videos/:videoId、ルーター経由で U6 到達。OQ-C2）を提供する。
 *
 * 表示専用に近い presentational で、副作用（取得）は検索フック（hooks 層）へ委譲する。
 * 制御フローは discriminated union（VideoSearchState / ViewState）で表現し、表示テキストで分岐しない。
 */

export interface SearchDialogProps {
  /** 表示状態。false のときは何も描画しない。 */
  open: boolean;
  /** 閉じる要求（キャンセル・再生ページ遷移時）。開閉状態の所有は親（AppShell）。 */
  onClose: () => void;
}

// upload_status enum → 表示ラベル。制御フローは enum で分岐し、ラベルでは分岐しない。
const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
};

/**
 * 検索状態（VideoSearchState）を結果領域の ViewState へ変換する。
 * idle（未検索）・invalidInput（入力不正）は結果領域を描画しない（null）。
 * invalidInput はフォーム直下のバリデーション表示で扱う（RegisterDialog と同様のパターン）。
 */
function toResultViewState(
  state: VideoSearchState,
): ViewState<Extract<VideoSearchState, { kind: "ok" }>> | null {
  switch (state.kind) {
    case "idle":
    case "invalidInput":
      return null;
    case "loading":
      return { status: "loading" };
    case "ok":
      return { status: "ready", data: state };
    case "notFound":
      return { status: "empty", variant: "nodata" };
    case "error":
      return { status: "error", message: state.message };
  }
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [backupFrom, setBackupFrom] = useState("");
  const [backupTo, setBackupTo] = useState("");
  const { search, state, refetch } = useVideoSearch();
  const navigate = useNavigate();

  // 閉じたら入力を初期化し、次回オープン時にクリーンな状態にする。
  // effect 内 setState を避け、prop 変化時にレンダー中で state を調整する（React 推奨パターン）。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setBackupFrom("");
      setBackupTo("");
    }
  }

  if (!open) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 空/不正入力の判定はフックに一元化する（API を叩かない）。
    search({ text: query, backupFrom, backupTo });
  };

  const validationMessage = state.kind === "invalidInput" ? state.message : null;
  const hasValidationError = validationMessage !== null;
  const resultViewState = toResultViewState(state);

  const handlePlay = (video: Video) => {
    // ルーター経由で U6（再生ページ）へ到達する（U2 非経由。OQ-C2）。
    onClose();
    navigate(generatePath(ROUTES.videoDetail, { videoId: video.videoId }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-dialog-title"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 id="search-dialog-title" className="text-lg font-semibold">
          動画を検索
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4" aria-label="動画検索フォーム">
          <div className="space-y-2">
            <Label htmlFor="search-input">タイトル、動画 ID または URL</Label>
            <div className="flex gap-2">
              <Input
                id="search-input"
                type="text"
                placeholder="猫 まとめ、dQw4w9WgXcQ、https://www.youtube.com/watch?v=..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-invalid={hasValidationError}
                aria-describedby={hasValidationError ? "search-input-error" : undefined}
              />
              <Button type="submit">検索</Button>
            </div>
            {hasValidationError && (
              <p id="search-input-error" role="alert" className="text-sm text-destructive">
                {validationMessage}
              </p>
            )}
          </div>
          {/* 日付欄は 2 列だと狭い画面で値とカレンダーアイコンが見切れるため、sm 未満は縦に積む。 */}
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="search-backup-from">バックアップ日（から）</Label>
              <Input
                id="search-backup-from"
                type="date"
                className="block"
                value={backupFrom}
                onChange={(event) => setBackupFrom(event.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="search-backup-to">バックアップ日（まで）</Label>
              <Input
                id="search-backup-to"
                type="date"
                className="block"
                value={backupTo}
                onChange={(event) => setBackupTo(event.target.value)}
              />
            </div>
          </div>
        </form>

        {resultViewState !== null && (
          <div className="mt-4">
            <StatusView
              state={resultViewState}
              onRetry={refetch}
              emptyMessage="指定した動画が見つかりませんでした。"
              loadingLabel="検索しています..."
            >
              {({ videos, hasMore }) => (
                <div className="space-y-4">
                  <ul className="space-y-4 divide-y" data-testid="search-result">
                    {videos.map((video) => (
                      <li key={video.videoId} className="space-y-3 pt-4 first:pt-0">
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                          <dt className="whitespace-nowrap text-muted-foreground">タイトル</dt>
                          <dd className="break-words font-medium">{video.title}</dd>
                          <dt className="whitespace-nowrap text-muted-foreground">
                            プラットフォーム
                          </dt>
                          <dd>{video.platform}</dd>
                          <dt className="whitespace-nowrap text-muted-foreground">
                            バックアップ日
                          </dt>
                          <dd>{video.backupDate}</dd>
                          <dt className="whitespace-nowrap text-muted-foreground">状態</dt>
                          <dd>{STATUS_LABEL[video.uploadStatus]}</dd>
                        </dl>
                        {video.uploadStatus === "complete" ? (
                          <Button onClick={() => handlePlay(video)}>再生ページへ</Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {hasMore && (
                    <p className="text-sm text-muted-foreground">
                      ほかにも該当する動画があります。条件を絞ってください。
                    </p>
                  )}
                </div>
              )}
            </StatusView>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
