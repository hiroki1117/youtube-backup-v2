import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/Toaster";
import { VideoPlaybackPage } from "@/app/VideoPlaybackPage";
import { server } from "@/test/server";
import { TEST_API_BASE, TEST_PRESIGNED_URL, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

/**
 * 再生ページのユニットテスト（U6 / US6.2・FR7・OQ2・A3・C4）。
 * RTL + memory router + MSW。complete→<video>+DL / 署名失敗→error(+retry) / init→再生不可 /
 * notFound / 戻るリンク / フォーカス / role・aria を検証する（実再生は jsdom 非対応のため src のみ検証）。
 */

function renderPage(id = "v1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/videos/${id}`]}>
        <Routes>
          <Route path="/videos/:videoId" element={<VideoPlaybackPage />} />
          <Route path="/videos" element={<div>一覧ページ</div>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("VideoPlaybackPage（U6 / US6.2・FR7・A3・C4）", () => {
  it("complete 動画は <video src=署名URL> と DL ボタンを表示する（happy path）", async () => {
    // 既定ハンドラ: GET /videos/:id → complete、GET /presigned-s3url → 成功。
    renderPage();

    const player = await screen.findByTestId("video-player");
    expect(player.tagName).toBe("VIDEO");
    expect(player).toHaveAttribute("src", TEST_PRESIGNED_URL);
    expect(player).toHaveAttribute("controls");
    expect(screen.getByTestId("playback-download-button")).toBeInTheDocument();
  });

  it("署名 URL 取得失敗は error フォールバック + 再試行を表示する（OQ2 / error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () => HttpResponse.error()),
    );
    renderPage();

    // error フォールバック（C4 role=alert）+ 再試行ボタン。
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    // 再生できないので <video> は出さない。
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
  });

  it("init 動画は再生不可メッセージを表示し再生/DL を出さない（A3）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ upload_status: "init" })),
      ),
    );
    renderPage("i1");

    expect(await screen.findByText(/まだ再生・ダウンロードできません/)).toBeInTheDocument();
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
    expect(screen.queryByTestId("playback-download-button")).not.toBeInTheDocument();
  });

  it("未存在の動画は「見つかりませんでした」を表示する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    renderPage("missing");

    expect(await screen.findByText(/見つかりませんでした/)).toBeInTheDocument();
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
  });

  it("一覧へ戻るリンクで一覧ページへ遷移する", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("video-player");

    await user.click(screen.getByTestId("playback-back-link"));

    expect(await screen.findByText("一覧ページ")).toBeInTheDocument();
  });

  it("表示時に見出しへフォーカスする（アクセシビリティ）", async () => {
    renderPage();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("playback-heading")),
    );
  });

  it("section に aria-label、<video> に aria-label を付与する（role/aria）", async () => {
    renderPage();

    const player = await screen.findByTestId("video-player");
    expect(player).toHaveAttribute("aria-label", expect.stringContaining("動画プレイヤー"));
    expect(screen.getByRole("region", { name: "動画再生" })).toBeInTheDocument();
  });
});
