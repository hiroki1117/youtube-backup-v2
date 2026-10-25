import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CommentBackupPanel } from "@/components/CommentBackupPanel";
import { StatusView, type ViewState } from "@/components/StatusView";
import { VideoDetail } from "@/components/VideoDetail";
import { VideoTitleEditor } from "@/components/VideoTitleEditor";
import { useCommentBackup } from "@/hooks/useCommentBackup";
import { useVideoDownload } from "@/hooks/useVideoDownload";
import { useVideoTitleEdit } from "@/hooks/useVideoTitleEdit";
import { useVideoPlayback, type PlaybackSource } from "@/hooks/useVideoPlayback";
import { ROUTES } from "@/lib/routes";
import { supportsCommentBackup } from "@/types/commentBackup";

/**
 * 動画再生ページ（U6 video-playback / US6.1・US6.2・FR6・FR7・OQ2・A3）。
 * URL param `videoId` を読み、`useVideoPlayback` で詳細 + 署名 URL を取得して状態別に描画する。
 * complete かつ署名 URL 取得成功 → `<video controls src>`（直接参照。認証ヘッダなし=preflight 回避）+
 * ダウンロード + 詳細 + 一覧へ戻るリンク。署名 URL 取得失敗（transport/CORS/期限切れ）→ error フォールバック
 * + 再試行（OQ2）。init/未存在 → 再生不可（再生/DL を出さない / A3）。
 *
 * 制御フローは discriminated union（PlaybackState / ViewState）で表現し、表示テキストで分岐しない。
 * アクセシビリティ: 表示時に見出しへフォーカスし、role/aria を付与する。
 * レイヤ境界: app 層。取得・DL ロジックは hooks（useVideoPlayback / useVideoDownload）へ委譲し、
 * 詳細表示は components（VideoDetail）へ委譲する。
 * 対応プラットフォームの complete 動画には、コメントのバックアップ欄（CommentBackupPanel）を出す。
 */

/** 署名 URL の取得状態（PlaybackSource）を StatusView の ViewState へ変換する。 */
function toSourceViewState(source: PlaybackSource): ViewState<string> {
  switch (source.status) {
    case "loading":
      return { status: "loading" };
    case "error":
      return { status: "error", message: source.message };
    case "ready":
      return { status: "ready", data: source.url };
  }
}

export function VideoPlaybackPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const playback = useVideoPlayback(videoId ?? "");
  const download = useVideoDownload();
  const titleEdit = useVideoTitleEdit(videoId ?? "");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 表示時に見出しへフォーカスする（アクセシビリティ。ページ遷移でフォーカスを画面先頭へ移す）。
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const state = playback.state;
  const loadedVideo = state.kind === "ready" || state.kind === "notPlayable" ? state.video : null;
  const headingText = loadedVideo?.title ?? "動画再生";
  // コメントは動画のバックアップが完了してから取得できる（backend は未完了を 409 にする）。
  const showComments = state.kind === "ready" && supportsCommentBackup(state.video.platform);
  const comments = useCommentBackup(videoId ?? "", showComments);

  const saveTitle = async (title: string) => {
    const saved = await titleEdit.save(title);
    if (saved) {
      setIsEditingTitle(false);
    }
    return saved;
  };

  return (
    <section aria-label="動画再生" className="space-y-4">
      <div>
        <Link
          to={ROUTES.videos}
          className="text-sm text-muted-foreground hover:underline"
          data-testid="playback-back-link"
        >
          ← 一覧へ戻る
        </Link>
      </div>
      {loadedVideo !== null && isEditingTitle ? (
        <VideoTitleEditor
          title={loadedVideo.title}
          isSaving={titleEdit.isSaving}
          onSave={saveTitle}
          onCancel={() => setIsEditingTitle(false)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 break-words text-xl font-semibold outline-hidden"
            data-testid="playback-heading"
          >
            {headingText}
          </h2>
          {loadedVideo !== null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditingTitle(true)}
              aria-label="タイトルを編集"
              data-testid="title-edit-button"
            >
              編集
            </Button>
          ) : null}
        </div>
      )}

      {state.kind === "loading" && (
        <StatusView state={{ status: "loading" }} loadingLabel="動画情報を読み込んでいます...">
          {() => null}
        </StatusView>
      )}

      {state.kind === "notFound" && (
        <StatusView
          state={{ status: "empty", variant: "nodata" }}
          emptyMessage="動画が見つかりませんでした。"
        >
          {() => null}
        </StatusView>
      )}

      {state.kind === "error" && (
        <StatusView state={{ status: "error", message: state.message }} onRetry={playback.refetch}>
          {() => null}
        </StatusView>
      )}

      {state.kind === "notPlayable" && (
        <div className="space-y-4">
          <p
            role="status"
            className="rounded-md border border-muted bg-muted/30 p-4 text-sm text-muted-foreground"
          >
            この動画はまだ再生・ダウンロードできません（処理中）。
          </p>
          <VideoDetail video={state.video} />
        </div>
      )}

      {state.kind === "ready" && (
        <div className="space-y-4">
          <StatusView
            state={toSourceViewState(state.source)}
            onRetry={playback.refetch}
            loadingLabel="再生準備中..."
          >
            {(url) => (
              <video
                controls
                src={url}
                className="w-full rounded-md bg-black"
                aria-label={`動画プレイヤー: ${state.video.title}`}
                data-testid="video-player"
              >
                お使いのブラウザは動画再生に対応していません。
              </video>
            )}
          </StatusView>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => download.download(state.video)}
              disabled={download.isPreparing}
              aria-label={`ダウンロード: ${state.video.title}`}
              data-testid="playback-download-button"
            >
              {download.isPreparing ? "準備中..." : "ダウンロード"}
            </Button>
          </div>
          <VideoDetail video={state.video} />
          {showComments ? (
            <CommentBackupPanel
              state={comments.state}
              isStarting={comments.isStarting}
              onStart={() => void comments.start()}
              onRetry={comments.refetch}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
