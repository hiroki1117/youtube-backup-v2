import { Button } from "@/components/ui/button";
import type { ViewState } from "@/types/viewState";
import type { YoutubeComment, YoutubeCommentThreads } from "@/types/youtubeComments";

/** 親コメントを並べ、返信は `<details>` に畳む。本文はテキストとして描画する（HTML 解釈しない）。 */

export interface YoutubeCommentListProps {
  state: ViewState<YoutubeCommentThreads>;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

function formatPostedAt(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function Badge({ children }: { children: string }) {
  return <span className="rounded border px-1 text-xs text-muted-foreground">{children}</span>;
}

function Comment({ comment }: { comment: YoutubeComment }) {
  return (
    <div className="space-y-1" data-testid="youtube-comment">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author ?? "(不明な投稿者)"}</span>
        {comment.postedAt !== null ? <span>{formatPostedAt(comment.postedAt)}</span> : null}
        <span aria-label={`高評価 ${comment.likeCount} 件`}>👍 {comment.likeCount}</span>
        {comment.isPinned ? <Badge>固定</Badge> : null}
        {comment.authorIsUploader ? <Badge>投稿者</Badge> : null}
        {comment.removed ? <Badge>YouTube では削除済み</Badge> : null}
      </div>
      <p className="whitespace-pre-wrap break-words">{comment.text}</p>
    </div>
  );
}

export function YoutubeCommentList({
  state,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onRetry,
}: YoutubeCommentListProps) {
  return (
    <section
      aria-label="バックアップしたコメント"
      className="space-y-3 text-sm"
      data-testid="youtube-comment-list"
    >
      {state.status === "loading" && (
        <p role="status" className="text-muted-foreground">
          コメントを読み込んでいます...
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="flex items-center gap-2">
          <span className="text-destructive">{state.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            再試行
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <p className="text-muted-foreground" data-testid="youtube-comment-total">
            {state.data.totalThreads === 0
              ? "バックアップしたコメントはありません。"
              : `${state.data.totalComments} 件（スレッド ${state.data.totalThreads} 件）`}
          </p>
          <ul className="space-y-4">
            {state.data.threads.map((thread) => (
              <li key={thread.commentId} className="space-y-2">
                <Comment comment={thread} />
                {thread.replies.length > 0 ? (
                  <details className="ml-2 space-y-2 border-l pl-3 md:ml-6">
                    {/* 負のマージンで、親の space-y-2 の間隔を保ったままタップ領域だけを広げる。 */}
                    <summary className="-mt-3 -mb-1 cursor-pointer py-3 text-xs text-muted-foreground">
                      返信 {thread.replies.length} 件
                    </summary>
                    {thread.replies.map((reply) => (
                      <Comment key={reply.commentId} comment={reply} />
                    ))}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          {hasMore ? (
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "読み込み中..." : "もっと見る"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
