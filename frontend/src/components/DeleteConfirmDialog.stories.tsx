import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { makeVideo } from "@/test/factories";

/**
 * 動画削除の確認ダイアログ（`role="alertdialog"`）（US-2 / US-8）。
 *
 * a11y 注記: 本ダイアログは独自モーダルで focus trap / Esc クローズ / scroll-lock を実装していない。
 * これらの動的キーボード挙動は axe（addon-a11y）では検出できないため、手動キーボード検証を要する。
 * addon-a11y が指摘するのは静的欠陥（ARIA 属性・アクセシブル名・コントラスト）に限られる。
 */
const meta = {
  title: "Components/DeleteConfirmDialog",
  component: DeleteConfirmDialog,
  args: {
    video: makeVideo({ title: "削除対象の動画" }),
    isDeleting: false,
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof DeleteConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

/** 削除実行中: 確定・キャンセルが無効化され、確定ボタンに `aria-busy` が付く。 */
export const Deleting: Story = {
  args: { isDeleting: true },
};

/** `video: null` のとき何も描画しない（ダイアログ非表示）。 */
export const Hidden: Story = {
  args: { video: null },
};

/** 処理中（init）の動画: 削除ではなくバックアップの取り消しとして確認する。 */
export const CancelBackup: Story = {
  args: { video: makeVideo({ title: "処理中の動画", uploadStatus: "init" }) },
};
