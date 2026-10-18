import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoDetail } from "@/components/VideoDetail";
import { makeVideo } from "@/test/factories";

/**
 * VideoDetail のユニットテスト（US-6 / FR4.1）。
 * `VideoPlaybackPage` から抽出した presentational コンポーネントが、抽出前と同一の DOM 契約
 * （`dl` + `data-testid="playback-detail"`、4 組の dt/dd、enum → ラベル変換）を保つことを検証する。
 */
describe("VideoDetail（US-6 抽出コンポーネント）", () => {
  it("title / platform / backupDate を dl 内に表示する（happy path）", () => {
    render(
      <VideoDetail
        video={makeVideo({
          title: "抽出テスト動画",
          platform: "twitter",
          backupDate: "2026-09-01",
        })}
      />,
    );

    const detail = screen.getByTestId("playback-detail");
    expect(within(detail).getByText("抽出テスト動画")).toBeInTheDocument();
    expect(within(detail).getByText("twitter")).toBeInTheDocument();
    expect(within(detail).getByText("2026-09-01")).toBeInTheDocument();
  });

  it("uploadStatus=complete は状態ラベル「完了」を表示する", () => {
    render(<VideoDetail video={makeVideo({ uploadStatus: "complete" })} />);

    expect(screen.getByText("完了")).toBeInTheDocument();
    expect(screen.queryByText("処理中")).not.toBeInTheDocument();
  });

  it("uploadStatus=init は状態ラベル「処理中」を表示する", () => {
    render(<VideoDetail video={makeVideo({ uploadStatus: "init" })} />);

    expect(screen.getByText("処理中")).toBeInTheDocument();
    expect(screen.queryByText("完了")).not.toBeInTheDocument();
  });

  it('data-testid="playback-detail" を持つ dl 要素として描画される（抽出前と同一の DOM 契約）', () => {
    render(<VideoDetail video={makeVideo()} />);

    const detail = screen.getByTestId("playback-detail");
    expect(detail.tagName).toBe("DL");
  });

  it("5 組の dt/dd（タイトル・プラットフォーム・バックアップ日・状態・元のページ）を持つ", () => {
    render(<VideoDetail video={makeVideo()} />);

    const detail = screen.getByTestId("playback-detail");
    const terms = detail.querySelectorAll("dt");
    const descriptions = detail.querySelectorAll("dd");
    expect(terms).toHaveLength(5);
    expect(descriptions).toHaveLength(5);
    expect(Array.from(terms).map((term) => term.textContent)).toEqual([
      "タイトル",
      "プラットフォーム",
      "バックアップ日",
      "状態",
      "元のページ",
    ]);
  });

  it("元のページは動画の元 URL を新しいタブで開くリンクになる", () => {
    render(
      <VideoDetail video={makeVideo({ videoUrl: "https://www.youtube.com/watch?v=abc123" })} />,
    );

    const link = screen.getByRole("link", { name: /元のページを開く/ });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("https 以外の URL では「元のページ」の行を表示しない（4 組）", () => {
    render(<VideoDetail video={makeVideo({ videoUrl: "javascript:alert(1)" })} />);

    const detail = screen.getByTestId("playback-detail");
    expect(detail.querySelectorAll("dt")).toHaveLength(4);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
