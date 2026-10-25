import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeVideo } from "@/test/factories";
import type { Video } from "@/types/video";
import { VideoCatalog, type RowActionHandlers } from "./VideoCatalog";

function renderCatalog(overrides: {
  data?: Video[];
  handlers?: RowActionHandlers;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onRetry?: () => void;
}) {
  const data = overrides.data ?? [
    makeVideo({ videoId: "c1", title: "完了動画", platform: "youtube", backupDate: "2026-08-03" }),
  ];
  return render(
    <VideoCatalog
      state={{ status: "ready", data }}
      hasMore={overrides.hasMore}
      onLoadMore={overrides.onLoadMore}
      isLoadingMore={overrides.isLoadingMore}
      onRetry={overrides.onRetry}
      handlers={overrides.handlers}
    />,
  );
}

describe("VideoCatalog（U2 / US2.1・C6 / FR8）", () => {
  it("ready 行は platform/title/backupDate/status ラベルを描画する", () => {
    renderCatalog({
      data: [
        makeVideo({
          videoId: "c1",
          title: "完了動画",
          platform: "youtube",
          backupDate: "2026-08-03",
        }),
      ],
    });
    expect(screen.getByRole("list", { name: "動画一覧" })).toBeInTheDocument();
    expect(screen.getByText("完了動画")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "YouTube" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-03")).toBeInTheDocument();
    expect(screen.getByText("完了")).toBeInTheDocument(); // complete の表示ラベル
  });

  it("init 行は状態ラベル「処理中」を描画する", () => {
    renderCatalog({
      data: [makeVideo({ videoId: "i1", title: "処理中動画", uploadStatus: "init" })],
    });
    expect(screen.getByText("処理中")).toBeInTheDocument();
  });

  it("各行に元のページへのリンクを新しいタブで開く形で描画する", () => {
    renderCatalog({
      data: [
        makeVideo({
          videoId: "c1",
          title: "完了動画",
          videoUrl: "https://www.youtube.com/watch?v=abc123",
        }),
      ],
    });
    const link = screen.getByRole("link", { name: "元のページを開く: 完了動画" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("https 以外の URL の行にはリンクを描画しない（NFR4）", () => {
    renderCatalog({
      data: [
        makeVideo({ videoId: "x1", title: "危険な URL", videoUrl: "javascript:alert(1)" }),
        makeVideo({ videoId: "x2", title: "http の URL", videoUrl: "http://example.com/v" }),
      ],
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("ハンドラ未提供時は行アクションボタンを描画しない（C6）", () => {
    renderCatalog({ handlers: undefined });
    expect(screen.queryByRole("button", { name: /再生/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /削除/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ダウンロード/ })).not.toBeInTheDocument();
  });

  it("提供されたハンドラのみボタンを描画し、その行の Video を渡す（C6）", async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const onDelete = vi.fn();
    const video = makeVideo({ videoId: "c1", title: "完了動画" });
    renderCatalog({ data: [video], handlers: { onPlay, onDelete } });

    // onDownload は未提供 → 描画されない
    expect(screen.queryByRole("button", { name: /ダウンロード/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再生: 完了動画" }));
    await user.click(screen.getByRole("button", { name: "削除: 完了動画" }));
    expect(onPlay).toHaveBeenCalledWith(video);
    expect(onDelete).toHaveBeenCalledWith(video);
  });

  it("onDownload は complete 行のみ描画する（init 行では非表示）", () => {
    const onDownload = vi.fn();
    renderCatalog({
      data: [
        makeVideo({ videoId: "c1", title: "完了動画", uploadStatus: "complete" }),
        makeVideo({ videoId: "i1", title: "処理中動画", uploadStatus: "init" }),
      ],
      handlers: { onDownload },
    });
    expect(screen.getByRole("button", { name: "ダウンロード: 完了動画" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ダウンロード: 処理中動画" }),
    ).not.toBeInTheDocument();
  });

  it("loading 状態は role=status を描画する", () => {
    render(<VideoCatalog state={{ status: "loading" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("error 状態は role=alert + 再試行で onRetry を発火する（FR8 error-path）", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <VideoCatalog state={{ status: "error", message: "取得に失敗しました" }} onRetry={onRetry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("取得に失敗しました");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("empty:nodata と empty:filtered で別メッセージを描画する（FR8）", () => {
    const { unmount } = render(<VideoCatalog state={{ status: "empty", variant: "nodata" }} />);
    expect(screen.getByText("バックアップ済み動画がありません")).toBeInTheDocument();
    unmount();

    render(<VideoCatalog state={{ status: "empty", variant: "filtered" }} />);
    expect(screen.getByText("条件に一致するデータがありません")).toBeInTheDocument();
  });

  it("hasMore のとき「もっと見る」を描画し、押下で onLoadMore を発火する", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderCatalog({ hasMore: true, onLoadMore });

    await user.click(screen.getByRole("button", { name: "もっと見る" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("続きがなければ「もっと見る」を描画しない", () => {
    renderCatalog({ hasMore: false, onLoadMore: vi.fn() });
    expect(screen.queryByRole("button", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("続きの読み込み中は「読み込み中...」で無効化する（二重押下防止）", () => {
    renderCatalog({ hasMore: true, onLoadMore: vi.fn(), isLoadingMore: true });
    expect(screen.getByRole("button", { name: "読み込み中..." })).toBeDisabled();
  });
});

describe("VideoCatalog 処理中の行の取り消し", () => {
  it("init 行の onDelete ボタンは「取り消し」、complete 行は「削除」と表示し、どちらも onDelete を呼ぶ", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const processing = makeVideo({ videoId: "i1", title: "処理中動画", uploadStatus: "init" });
    const done = makeVideo({ videoId: "c1", title: "完了動画", uploadStatus: "complete" });
    renderCatalog({ data: [processing, done], handlers: { onDelete } });

    expect(screen.queryByRole("button", { name: "削除: 処理中動画" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取り消し: 処理中動画" }));
    expect(onDelete).toHaveBeenCalledWith(processing);
    await user.click(screen.getByRole("button", { name: "削除: 完了動画" }));
    expect(onDelete).toHaveBeenCalledWith(done);
  });
});
