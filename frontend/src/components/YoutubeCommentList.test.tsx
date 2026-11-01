import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { YoutubeCommentList, type YoutubeCommentListState } from "@/components/YoutubeCommentList";
import type { YoutubeComment } from "@/types/youtubeComments";

/**
 * YoutubeCommentList のユニットテスト。スレッドと返信の描画、印（固定・投稿者・削除済み）、
 * 件数・空表示、「もっと見る」、読み込み中・失敗の表示を検証する。
 */

function comment(overrides: Partial<YoutubeComment> = {}): YoutubeComment {
  return {
    commentId: "c1",
    text: "本文",
    likeCount: 0,
    author: "@viewer",
    authorIsUploader: false,
    isPinned: false,
    postedAt: 1792713600,
    removed: false,
    ...overrides,
  };
}

function renderList(state: YoutubeCommentListState, hasMore = false, isLoadingMore = false) {
  const onLoadMore = vi.fn();
  const onRetry = vi.fn();
  render(
    <YoutubeCommentList
      state={state}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      onRetry={onRetry}
    />,
  );
  return { onLoadMore, onRetry };
}

describe("YoutubeCommentList", () => {
  it("スレッドの本文・投稿者・日付・高評価と、返信の件数を表示する", () => {
    renderList({
      kind: "ready",
      totalThreads: 1,
      totalComments: 3,
      threads: [
        {
          ...comment({ text: "1 行目\n2 行目", likeCount: 7 }),
          replies: [comment({ commentId: "r1" }), comment({ commentId: "r2" })],
        },
      ],
    });
    expect(screen.getByTestId("youtube-comment-total")).toHaveTextContent("3 件（スレッド 1 件）");
    const [first] = screen.getAllByTestId("youtube-comment");
    expect(within(first).getByText("@viewer")).toBeInTheDocument();
    expect(within(first).getByText("2026/10/23")).toBeInTheDocument();
    expect(within(first).getByLabelText("高評価 7 件")).toBeInTheDocument();
    expect(within(first).getByText(/1 行目/)).toHaveTextContent("1 行目 2 行目");
    expect(screen.getByText("返信 2 件")).toBeInTheDocument();
  });

  it("固定・投稿者・YouTube で削除済みの印を付ける", () => {
    renderList({
      kind: "ready",
      totalThreads: 1,
      totalComments: 1,
      threads: [
        {
          ...comment({ isPinned: true, authorIsUploader: true, removed: true, author: null }),
          replies: [],
        },
      ],
    });
    expect(screen.getByText("固定")).toBeInTheDocument();
    expect(screen.getByText("投稿者")).toBeInTheDocument();
    expect(screen.getByText("YouTube では削除済み")).toBeInTheDocument();
    expect(screen.getByText("(不明な投稿者)")).toBeInTheDocument();
    expect(screen.queryByText(/返信/)).not.toBeInTheDocument();
  });

  it("コメントがなければその旨を表示する", () => {
    renderList({ kind: "ready", totalThreads: 0, totalComments: 0, threads: [] });
    expect(screen.getByText("バックアップしたコメントはありません。")).toBeInTheDocument();
  });

  it("続きがあれば「もっと見る」で読み込み、読み込み中は無効にする", async () => {
    const ready: YoutubeCommentListState = {
      kind: "ready",
      totalThreads: 2,
      totalComments: 2,
      threads: [{ ...comment(), replies: [] }],
    };
    const { onLoadMore } = renderList(ready, true);
    await userEvent.setup().click(screen.getByRole("button", { name: "もっと見る" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("続きの読み込み中はボタンを無効にする", () => {
    renderList(
      {
        kind: "ready",
        totalThreads: 2,
        totalComments: 2,
        threads: [{ ...comment(), replies: [] }],
      },
      true,
      true,
    );
    expect(screen.getByRole("button", { name: "読み込み中..." })).toBeDisabled();
  });

  it("読み込みの失敗はメッセージと再試行を出す（error-path）", async () => {
    const { onRetry } = renderList({ kind: "error", message: "読み込めませんでした" });
    expect(screen.getByRole("alert")).toHaveTextContent("読み込めませんでした");
    await userEvent.setup().click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("読み込み中は状態だけを出す", () => {
    renderList({ kind: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("コメントを読み込んでいます");
  });
});
