import { Button } from "@/components/ui/button";
import type { PlaylistRegistrationState } from "@/hooks/usePlaylistRegistration";

/**
 * 再生リストからの一括登録の画面（登録ダイアログの中で、確認 → 登録中 → 結果 を表示する）。
 * 状態は usePlaylistRegistration が持ち、ここは表示と操作の受け渡しだけを行う presentational。
 * 複数本が一度にバックアップされるため、確定の前に本数と動画タイトルを必ず見せる。
 */

export interface PlaylistRegistrationProps {
  /** idle・loading 以外の状態（それらは登録ダイアログの入力欄が表示する）。 */
  state: Extract<PlaylistRegistrationState, { step: "preview" | "registering" | "finished" }>;
  onRegister: () => void;
  onStop: () => void;
  /** 入力に戻る。 */
  onBack: () => void;
  onClose: () => void;
}

export function PlaylistRegistration({
  state,
  onRegister,
  onStop,
  onBack,
  onClose,
}: PlaylistRegistrationProps) {
  const { playlist } = state;
  const total = playlist.videos.length;

  switch (state.step) {
    case "preview":
      return (
        <div className="mt-4 space-y-4">
          {total === 0 ? (
            <p>登録できる動画がありません。</p>
          ) : (
            <p>
              <span className="font-semibold">{total} 本</span>を登録します。
            </p>
          )}
          {playlist.unavailableCount > 0 && (
            <p className="text-sm text-muted-foreground">
              非公開・削除済みの {playlist.unavailableCount} 本は登録できないため除きます。
            </p>
          )}
          {total > 0 && (
            <ol
              aria-label="登録する動画"
              className="max-h-64 list-decimal space-y-1 overflow-y-auto rounded-md border py-2 pr-3 pl-8 text-sm"
            >
              {playlist.videos.map((video) => (
                <li key={video.videoId} className="break-words">
                  {video.title}
                </li>
              ))}
            </ol>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onBack}>
              戻る
            </Button>
            {total > 0 && (
              <Button type="button" onClick={onRegister} autoFocus>
                {total} 本を登録
              </Button>
            )}
          </div>
        </div>
      );
    case "registering":
      return (
        <div className="mt-4 space-y-4">
          <p id="playlist-progress-label" aria-live="polite">
            登録しています… {state.done} / {total} 本
          </p>
          <progress
            className="h-2 w-full accent-primary"
            value={state.done}
            max={total}
            aria-labelledby="playlist-progress-label"
          />
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onStop}>
              中止
            </Button>
          </div>
        </div>
      );
    case "finished": {
      const { result } = state;
      const processed = result.started + result.existing + result.failed.length;
      return (
        <div className="mt-4 space-y-4">
          <ul aria-label="登録の結果" className="space-y-1">
            <li>バックアップを開始: {result.started} 本</li>
            <li>登録済み: {result.existing} 本</li>
            <li>失敗: {result.failed.length} 本</li>
          </ul>
          {result.stopped && (
            <p className="text-sm text-muted-foreground">
              途中で中止したため、残りの {total - processed} 本は登録していません。
              同じ再生リストをもう一度登録すると、残りから登録できます。
            </p>
          )}
          {result.failed.length > 0 && (
            <ul
              aria-label="登録できなかった動画"
              className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm"
            >
              {result.failed.map(({ video, message }) => (
                <li key={video.videoId} className="break-words">
                  {video.title}
                  <span className="block text-destructive">{message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={onClose} autoFocus>
              閉じる
            </Button>
          </div>
        </div>
      );
    }
  }
}
