import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommentBackupPanel, type CommentBackupPanelState } from "@/components/CommentBackupPanel";
import type { CommentBackup } from "@/types/commentBackup";

/**
 * CommentBackupPanel のユニットテスト。状態ごとのラベル・最終取得の表示と、
 * 開始ボタンの文言・有効/無効（未取得=バックアップ、取得済み・失敗=最新化、取得中=無効）を検証する。
 */

function backup(overrides: Partial<CommentBackup> = {}): CommentBackup {
  return {
    videoId: "v1",
    platform: "youtube",
    state: "not_started",
    commentCount: null,
    completedAt: null,
    ...overrides,
  };
}

function renderPanel(state: CommentBackupPanelState, isStarting = false) {
  const onStart = vi.fn();
  const onRetry = vi.fn();
  render(
    <CommentBackupPanel
      state={state}
      isStarting={isStarting}
      onStart={onStart}
      onRetry={onRetry}
    />,
  );
  return { onStart, onRetry };
}

describe("CommentBackupPanel", () => {
  it("未取得は「コメントをバックアップ」で開始できる", async () => {
    const { onStart } = renderPanel({ kind: "ready", backup: backup() });
    expect(screen.getByTestId("comment-backup-state")).toHaveTextContent("未取得");
    expect(screen.queryByTestId("comment-backup-last")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "コメントをバックアップ" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("取得済みは最終取得の時刻（日本時間）と件数を出し、「コメントを最新化」にする", () => {
    renderPanel({
      kind: "ready",
      backup: backup({ state: "complete", commentCount: 246, completedAt: 1792713600 }),
    });
    expect(screen.getByTestId("comment-backup-state")).toHaveTextContent("取得済み");
    expect(screen.getByTestId("comment-backup-last")).toHaveTextContent(
      "2026/10/23 9:00:00（246 件）",
    );
    expect(screen.getByRole("button", { name: "コメントを最新化" })).toBeEnabled();
  });

  it("取得中はボタンを無効にし、前回の結果は残す", () => {
    renderPanel({
      kind: "ready",
      backup: backup({ state: "running", commentCount: 10, completedAt: 1792713600 }),
    });
    expect(screen.getByRole("button", { name: "取得中..." })).toBeDisabled();
    expect(screen.getByTestId("comment-backup-last")).toHaveTextContent("10 件");
  });

  it("開始要求の実行中はボタンを無効にする", () => {
    renderPanel({ kind: "ready", backup: backup() }, true);
    expect(screen.getByRole("button", { name: "開始中..." })).toBeDisabled();
  });

  it("失敗は再取得（最新化）できる", () => {
    renderPanel({ kind: "ready", backup: backup({ state: "failed" }) });
    expect(screen.getByTestId("comment-backup-state")).toHaveTextContent("失敗");
    expect(screen.getByRole("button", { name: "コメントを最新化" })).toBeEnabled();
  });

  it("照会の失敗はメッセージと再試行を出し、開始ボタンは出さない（error-path）", async () => {
    const { onRetry } = renderPanel({ kind: "error", message: "通信に失敗しました。" });
    expect(screen.getByRole("alert")).toHaveTextContent("通信に失敗しました。");
    expect(screen.queryByTestId("comment-backup-button")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("読み込み中は状態だけを出す", () => {
    renderPanel({ kind: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("読み込んでいます");
    expect(screen.queryByTestId("comment-backup-button")).not.toBeInTheDocument();
  });
});
