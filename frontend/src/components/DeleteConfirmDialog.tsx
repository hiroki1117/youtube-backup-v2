import { Button } from "@/components/ui/button";
import type { Video } from "@/types/video";

export interface DeleteConfirmDialogProps {
  /** null のときは何も描画しない。 */
  video: Video | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  video,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  if (video === null) {
    return null;
  }
  // 処理中（init）の動画の削除は、バックアップの取り消し（ジョブ停止 + 記録削除）になる。
  const isCancel = video.uploadStatus === "init";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-t-lg border bg-background p-6 shadow-lg md:rounded-lg"
        data-testid="delete-confirm-dialog"
      >
        <h2 id="delete-dialog-title" className="text-lg font-semibold">
          {isCancel ? "バックアップを取り消し" : "動画を削除"}
        </h2>
        <p
          id="delete-dialog-description"
          className="mt-4 break-words text-sm text-muted-foreground"
        >
          {isCancel
            ? `「${video.title}」のバックアップを中止し、一覧から削除します。同じ URL はあとで再登録できます。`
            : `「${video.title}」を削除します。バックアップしたコメントも削除されます。この操作は取り消せません。`}
        </p>
        {/* スマホでは親指が届くよう、確定を下にして縦に並べる。 */}
        <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isDeleting}>
            キャンセル
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            aria-busy={isDeleting}
            data-testid="delete-confirm-button"
          >
            {isCancel ? "取り消す" : "削除する"}
          </Button>
        </div>
      </div>
    </div>
  );
}
