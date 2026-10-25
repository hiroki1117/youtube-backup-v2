import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeVideo } from "@/test/factories";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

describe("DeleteConfirmDialog（U5 / US5.1・FR5.1）", () => {
  it("video が null のとき何も描画しない", () => {
    render(
      <DeleteConfirmDialog
        video={null}
        isDeleting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("alertdialog の role/aria を備える（アクセシビリティ）", () => {
    render(
      <DeleteConfirmDialog
        video={makeVideo({ title: "削除対象動画" })}
        isDeleting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("動画を削除");
    // aria-describedby が説明文を参照している。
    expect(dialog).toHaveAccessibleDescription(/削除対象動画/);
  });

  it("削除対象の title を提示する", () => {
    render(
      <DeleteConfirmDialog
        video={makeVideo({ title: "とても大事な動画" })}
        isDeleting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/とても大事な動画/)).toBeInTheDocument();
  });

  it("確定ボタンで onConfirm が呼ばれる", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        video={makeVideo()}
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("キャンセルボタンで onCancel が呼ばれる", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DeleteConfirmDialog
        video={makeVideo()}
        isDeleting={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("削除実行中は確定・キャンセルボタンが無効化される（二重確定抑止）", () => {
    render(
      <DeleteConfirmDialog video={makeVideo()} isDeleting onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    const confirmButton = screen.getByRole("button", { name: "削除する" });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
  });
});

describe("DeleteConfirmDialog 処理中の動画（バックアップの取り消し）", () => {
  it("init の動画は取り消しの文言を表示し、確定で onConfirm を呼ぶ", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        video={makeVideo({ title: "処理中動画", uploadStatus: "init" })}
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("バックアップを取り消し")).toBeInTheDocument();
    expect(screen.getByText(/バックアップを中止し、一覧から削除します/)).toBeInTheDocument();
    expect(screen.queryByText(/この操作は取り消せません/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取り消す" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
