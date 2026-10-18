import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 認証は AuthModule をモックして authenticated 固定（Cognito ネットワークに出ない）。
// API は MSW（ApiClient は実コードを通す）。DL 起動（download.ts）はモックして検証する。
const { getSessionMock, signInMock, signOutMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/api/auth", () => ({
  authModule: {
    getSession: getSessionMock,
    signIn: signInMock,
    signOut: signOutMock,
  },
}));

vi.mock("@/lib/download", () => ({
  downloadPresignedUrl: vi.fn(() => true),
}));

import { downloadPresignedUrl } from "@/lib/download";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { Toaster } from "@/components/Toaster";
import { routes } from "@/app/routes";
import { server } from "@/test/server";
import { TEST_API_BASE, TEST_PRESIGNED_URL } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

const downloadMock = vi.mocked(downloadPresignedUrl);

function renderApp(initialEntries: string[] = ["/videos"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("再生/ダウンロード 結合（一覧→再生・DL / US6.1・US6.2・FR6・FR7・C6・OQ2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
    downloadMock.mockReturnValue(true);
  });

  it("一覧の「再生」→ /videos/:id へ遷移しプレイヤーを表示する（US6.2 / C6）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ video_id: "c1", title: "再生対象動画" })]),
      ),
      // 詳細取得は param の id に対して complete 動画を返す。
      http.get(`${TEST_API_BASE}/videos/:videoId`, ({ params }) =>
        HttpResponse.json(
          makeRawVideo({ video_id: String(params.videoId), title: "再生対象動画" }),
        ),
      ),
    );
    renderApp();
    await screen.findByText("再生対象動画");

    await user.click(screen.getByRole("button", { name: "再生: 再生対象動画" }));

    // 再生ページのプレイヤーが署名 URL を source に表示される。
    const player = await screen.findByTestId("video-player");
    expect(player).toHaveAttribute("src", TEST_PRESIGNED_URL);
  });

  it("一覧の「ダウンロード」→ 署名 URL を取得し download を起動する（US6.1 / FR6 / C6）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ video_id: "c1", title: "DL対象動画" })]),
      ),
    );
    renderApp();
    await screen.findByText("DL対象動画");

    // complete 行にのみ DL ボタンが描画される（C6 / A3）。
    await user.click(screen.getByRole("button", { name: "ダウンロード: DL対象動画" }));

    await vi.waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(downloadMock).toHaveBeenCalledWith(TEST_PRESIGNED_URL, expect.any(String));
  });

  it("再生ページで署名 URL 取得に失敗すると error フォールバックを表示する（OQ2 / error-path）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ video_id: "c1", title: "再生失敗動画" })]),
      ),
      http.get(`${TEST_API_BASE}/videos/:videoId`, ({ params }) =>
        HttpResponse.json(
          makeRawVideo({ video_id: String(params.videoId), title: "再生失敗動画" }),
        ),
      ),
      // 署名 URL 取得が transport/CORS 失敗する。
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () => HttpResponse.error()),
    );
    renderApp();
    await screen.findByText("再生失敗動画");

    await user.click(screen.getByRole("button", { name: "再生: 再生失敗動画" }));

    // error フォールバック（C4 role=alert）+ 再試行。プレイヤーは表示しない。
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
  });
});
