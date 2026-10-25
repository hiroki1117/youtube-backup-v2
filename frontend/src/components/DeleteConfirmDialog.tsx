import { Button } from "@/components/ui/button";
import type { Video } from "@/types/video";

/**
 * 動画削除の確認ダイアログ（U5 video-deletion / US5.1・FR5.1）。
 * 削除対象の title を提示し、確定/キャンセルを提供する。削除実行中は確定・キャンセルを無効化して
 * 二重確定を抑止する。表示専用（presentational）で副作用・API 依存を持たず、実行は hooks 層
 * （useVideoDeletion）に委譲する。制御フローは props（boolean / null 判別）で表現し、表示テキストでは
 * 分岐しない。破壊的操作のため role="alertdialog" を付与する。
 */

export interface DeleteConfirmDialogProps {
  /** 削除対象。null のとき何も描画しない（ダイアログ非表示）。 */
  video: Video | null;
  /** 削除実行中フラグ。確定・キャンセルボタンを無効化する。 */
  isDeleting: boolean;
  /** 削除を確定する。 */
  onConfirm: () => void;
  /** 削除をキャンセルする（ダイアログを閉じる）。 */
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        data-testid="delete-confirm-dialog"
      >
        <h2 id="delete-dialog-title" className="text-lg font-semibold">
          {isCancel ? "バックアップを取り消し" : "動画を削除"}
        </h2>
        <p id="delete-dialog-description" className="mt-4 text-sm text-muted-foreground">
          {isCancel
            ? `「${video.title}」のバックアップを中止し、一覧から削除します。同じ URL はあとで再登録できます。`
            : `「${video.title}」を削除します。バックアップしたコメントも削除されます。この操作は取り消せません。`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
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
