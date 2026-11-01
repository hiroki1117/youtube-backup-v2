import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 認証は AuthModule をモックして authenticated 固定（Cognito ネットワークに出ない）。
// API は MSW（ApiClient は実コードを通す）。
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

import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { Toaster } from "@/components/Toaster";
import { routes } from "@/app/routes";
import { makeRawVideo } from "@/test/factories";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";

function renderApp(initialEntries: string[] = ["/videos"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("動画検索 結合（ヘッダ→検索ページ→結果 / US3.1・FR3.1・C5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
  });

  it("ヘッダの検索欄から検索ページへ移り、結果を開ける", async () => {
    const user = userEvent.setup();
    // GET /videos/:videoId の既定ハンドラ = complete 動画（title: "サンプル動画"）。
    const router = renderApp();

    await user.type(await screen.findByRole("searchbox", { name: "動画を検索" }), "v1{Enter}");

    expect(await screen.findByRole("list", { name: "検索結果" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/search");
    expect(router.state.location.search).toBe("?q=v1");

    await user.click(screen.getByRole("link", { name: /^サンプル動画/ }));

    expect(router.state.location.pathname).toBe("/videos/v1");
  });

  it("検索ページではヘッダの検索欄を重ねて出さない", async () => {
    renderApp(["/search"]);

    expect(await screen.findByRole("searchbox", { name: "検索語" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "動画を検索" })).not.toBeInTheDocument();
  });

  it("狭い画面向けのアイコンから検索ページを開ける", async () => {
    const user = userEvent.setup();
    const router = renderApp();

    await user.click(await screen.findByRole("link", { name: "検索ページを開く" }));

    expect(router.state.location.pathname).toBe("/search");
  });

  it("「/」キーで検索欄へ移る。入力中の「/」は奪わない", async () => {
    const user = userEvent.setup();
    const router = renderApp();
    const box = await screen.findByRole("searchbox", { name: "動画を検索" });

    // jsdom にはレイアウトがなく検索欄が非表示扱いになるので、検索ページへの移動で確かめる。
    await user.keyboard("/");
    expect(router.state.location.pathname).toBe("/search");

    await router.navigate("/videos");
    const header = await screen.findByRole("searchbox", { name: "動画を検索" });
    expect(header).not.toBe(box);
    await user.type(header, "a/b");
    expect(header).toHaveValue("a/b");
    expect(router.state.location.pathname).toBe("/videos");
  });

  it("タイトルで検索すると一致部分を強調する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
      http.get(`${TEST_API_BASE}/search/videos`, () =>
        HttpResponse.json({
          items: [makeRawVideo({ title: "猫の動画" })],
          has_more: false,
        }),
      ),
    );
    renderApp(["/search?q=%E7%8C%AB"]);

    const mark = await screen.findByText("猫");

    expect(mark.tagName).toBe("MARK");
  });

  it("transport 失敗は error 表示にフォールバックする（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    renderApp(["/search?q=v1"]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("通信");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
