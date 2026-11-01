import { Button } from "@/components/ui/button";
import {
  isCommentBackupInProgress,
  type CommentBackup,
  type CommentBackupState,
} from "@/types/commentBackup";

/**
 * コメントバックアップの状態と開始ボタンを表示する presentational コンポーネント。
 * 未取得なら「コメントをバックアップ」、取得済み・失敗なら「コメントを最新化」を出し、取得中は無効にする。
 * 副作用・API 依存を持たない（レイヤ境界: components → types のみ）。状態は enum で分岐する。
 */

const STATE_LABEL: Record<CommentBackupState, string> = {
  not_started: "未取得",
  submitting: "開始中",
  running: "取得中",
  awaiting_ingest: "取り込み中",
  complete: "取得済み",
  failed: "失敗",
};

/** 読み込み中・照会失敗の間はボタンを出さず、メッセージ（と再試行）だけを表示する。 */
export type CommentBackupPanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; backup: CommentBackup };

export interface CommentBackupPanelProps {
  state: CommentBackupPanelState;
  isStarting: boolean;
  onStart: () => void;
  onRetry: () => void;
}

function formatCompletedAt(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function CommentBackupPanel({
  state,
  isStarting,
  onStart,
  onRetry,
}: CommentBackupPanelProps) {
  return (
    <section
      aria-label="コメントのバックアップ"
      className="space-y-2 rounded-md border p-4 text-sm"
      data-testid="comment-backup-panel"
    >
      <h3 className="font-medium">コメント</h3>
      {state.kind === "loading" && (
        <p role="status" className="text-muted-foreground">
          コメントの状態を読み込んでいます...
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
        <ReadyContent backup={state.backup} isStarting={isStarting} onStart={onStart} />
      )}
    </section>
  );
}

function ReadyContent({
  backup,
  isStarting,
  onStart,
}: {
  backup: CommentBackup;
  isStarting: boolean;
  onStart: () => void;
}) {
  const inProgress = isCommentBackupInProgress(backup.state);
  const label = isStarting
    ? "開始中..."
    : inProgress
      ? "取得中..."
      : backup.state === "not_started"
        ? "コメントをバックアップ"
        : "コメントを最新化";
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">状態</dt>
        <dd data-testid="comment-backup-state">{STATE_LABEL[backup.state]}</dd>
        {backup.completedAt !== null ? (
          <>
            <dt className="text-muted-foreground">最終取得</dt>
            <dd data-testid="comment-backup-last">
              {formatCompletedAt(backup.completedAt)}（{backup.commentCount ?? 0} 件）
            </dd>
          </>
        ) : null}
      </dl>
      <Button
        size="sm"
        onClick={onStart}
        disabled={isStarting || inProgress}
        data-testid="comment-backup-button"
      >
        {label}
      </Button>
    </>
  );
}
