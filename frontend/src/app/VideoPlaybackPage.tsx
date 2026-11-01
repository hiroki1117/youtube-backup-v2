import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CommentBackupPanel } from "@/components/CommentBackupPanel";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { YoutubeCommentList } from "@/components/YoutubeCommentList";
import { StatusView } from "@/components/StatusView";
import { VideoDetail } from "@/components/VideoDetail";
import { VideoTitleEditor } from "@/components/VideoTitleEditor";
import { useCommentBackup } from "@/hooks/useCommentBackup";
import { useVideoDeletion } from "@/hooks/useVideoDeletion";
import { useVideoDownload } from "@/hooks/useVideoDownload";
import { useYoutubeComments } from "@/hooks/useYoutubeComments";
import { useVideoTitleEdit } from "@/hooks/useVideoTitleEdit";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { ROUTES } from "@/lib/routes";
import { supportsCommentBackup } from "@/types/commentBackup";
import { REMOVE_LABEL, type Video } from "@/types/video";

/**
 * 動画の再生・ダウンロードと詳細、コメント、削除（init は取り消し）。
 * 署名 URL を `<video src>` に直接渡す（認証ヘッダなしなので preflight が起きない）。
 * 削除はスマホ幅の一覧では行に出さないため、ここからも行える。成功したら一覧へ戻る。
 */

function RemoveButton({ video, onClick }: { video: Video; onClick: () => void }) {
  const label = REMOVE_LABEL[video.uploadStatus];
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-label={`${label}: ${video.title}`}
      data-testid="playback-delete-button"
    >
      {label}
    </Button>
  );
}

export function VideoPlaybackPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const playback = useVideoPlayback(videoId ?? "");
  const download = useVideoDownload();
  const navigate = useNavigate();
  const deletion = useVideoDeletion({
    // 削除した動画のページは残らないので、履歴を置き換えて一覧へ戻る（戻るで消えたページに来ない）。
    onDeleted: () => navigate(ROUTES.videos, { replace: true }),
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleEdit = useVideoTitleEdit(videoId ?? "", () => setIsEditingTitle(false));
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
  // 完了時刻が変わる（再取得が完了する）たびに一覧を読み直す。
  const completedAt = comments.state.status === "ready" ? comments.state.data.completedAt : null;
  const commentList = useYoutubeComments(videoId ?? "", completedAt, showComments);

  return (
    <section aria-label="動画再生" className="flex flex-col gap-4">
      {/* スマホでは動画を最上部に置くので、戻るリンクと動画に order-first を付ける（docs/mobile-ui.md）。
          見出しは読み上げの順序を保つため DOM では動画より前に置く。 */}
      <div className="max-md:order-first">
        <Link
          to={ROUTES.videos}
          // 負のマージンで、周囲の余白を変えずにタップ領域だけを広げる。
          className="-my-3 inline-block py-3 text-sm text-muted-foreground hover:underline"
          data-testid="playback-back-link"
        >
          ← 一覧へ戻る
        </Link>
      </div>
      {loadedVideo !== null && isEditingTitle ? (
        <VideoTitleEditor
          title={loadedVideo.title}
          isSaving={titleEdit.isSaving}
          onSave={titleEdit.save}
          onCancel={() => setIsEditingTitle(false)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 break-words text-lg font-semibold outline-hidden md:text-xl"
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
        <StatusView state={{ status: "loading" }} loadingLabel="動画情報を読み込んでいます..." />
      )}

      {state.kind === "notFound" && (
        <StatusView state={{ status: "empty", message: "動画が見つかりませんでした。" }} />
      )}

      {state.kind === "error" && (
        <StatusView
          state={{ status: "error", message: state.message }}
          onRetry={playback.refetch}
        />
      )}

      {state.kind === "notPlayable" && (
        <div className="space-y-4">
          <p
            role="status"
            className="rounded-md border border-muted bg-muted/30 p-4 text-sm text-muted-foreground"
          >
            この動画はまだ再生・ダウンロードできません（処理中）。
          </p>
          <div className="flex items-center gap-2">
            <RemoveButton video={state.video} onClick={() => deletion.requestDelete(state.video)} />
          </div>
          <VideoDetail video={state.video} />
        </div>
      )}

      {state.kind === "ready" && (
        // スマホでは contents で子を section の並びに加え、プレイヤーだけ最上部へ動かす。
        <div className="contents md:flex md:flex-col md:gap-4">
          <div className="max-md:order-first max-md:-mx-4">
            <StatusView
              state={state.source}
              onRetry={playback.refetch}
              loadingLabel="再生準備中..."
            >
              {(url) => (
                <video
                  controls
                  // iPhone でページ内のまま再生する（無いと再生開始で全画面に切り替わる）。
                  playsInline
                  src={url}
                  // dvh だとアドレスバーの開閉で動画の高さが変わり、スクロール中にページがずれる。
                  // 縦持ちは、縦長の動画でも下の見出しとダウンロードが見える高さに抑える。
                  className="max-h-[80svh] w-full bg-black max-md:portrait:max-h-[60svh] md:rounded-md"
                  aria-label={`動画プレイヤー: ${state.video.title}`}
                  data-testid="video-player"
                >
                  お使いのブラウザは動画再生に対応していません。
                </video>
              )}
            </StatusView>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="max-md:flex-1"
              onClick={() => download.download(state.video)}
              disabled={download.isPreparing}
              aria-label={`ダウンロード: ${state.video.title}`}
              data-testid="playback-download-button"
            >
              {download.isPreparing ? "準備中..." : "ダウンロード"}
            </Button>
            <RemoveButton video={state.video} onClick={() => deletion.requestDelete(state.video)} />
          </div>
          <VideoDetail video={state.video} />
          {showComments ? (
            <CommentBackupPanel
              state={comments.state}
              isStarting={comments.isStarting}
              onStart={() => comments.start()}
              onRetry={comments.refetch}
            />
          ) : null}
          {showComments && completedAt !== null ? (
            <YoutubeCommentList
              state={commentList.state}
              hasMore={commentList.hasMore}
              isLoadingMore={commentList.isLoadingMore}
              onLoadMore={commentList.loadMore}
              onRetry={commentList.refetch}
            />
          ) : null}
        </div>
      )}

      <DeleteConfirmDialog
        video={deletion.pendingVideo}
        isDeleting={deletion.isDeleting}
        onConfirm={deletion.confirmDelete}
        onCancel={deletion.cancelDelete}
      />
    </section>
  );
}
