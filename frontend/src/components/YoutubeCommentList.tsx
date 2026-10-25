import { Button } from "@/components/ui/button";
import type { YoutubeComment, YoutubeCommentThread } from "@/types/youtubeComments";

/**
 * バックアップした YouTube コメントの一覧（presentational）。
 * スレッドごとに親コメントを出し、返信は `<details>` に畳む。本文はテキストとして描画する（HTML 解釈しない）。
 * YouTube で削除・非表示になったコメント（removed）には印を付ける。
 * 副作用・API 依存を持たない（レイヤ境界: components → types のみ）。
 */

export type YoutubeCommentListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      threads: YoutubeCommentThread[];
      totalThreads: number;
      totalComments: number;
    };

export interface YoutubeCommentListProps {
  state: YoutubeCommentListState;
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
      {state.kind === "loading" && (
        <p role="status" className="text-muted-foreground">
          コメントを読み込んでいます...
        </p>
      )}
      {state.kind === "error" && (
        <div role="alert" className="flex items-center gap-2">
          <span className="text-destructive">{state.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            再試行
          </Button>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <p className="text-muted-foreground" data-testid="youtube-comment-total">
            {state.totalThreads === 0
              ? "バックアップしたコメントはありません。"
              : `${state.totalComments} 件（スレッド ${state.totalThreads} 件）`}
          </p>
          <ul className="space-y-4">
            {state.threads.map((thread) => (
              <li key={thread.commentId} className="space-y-2">
                <Comment comment={thread} />
                {thread.replies.length > 0 ? (
                  <details className="ml-6 space-y-2 border-l pl-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
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
