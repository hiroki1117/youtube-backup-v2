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
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";

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

async function openSearchDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "動画を検索" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
}

describe("動画検索 結合（ヘッダ→ダイアログ→検索 / US3.1・FR3.1・C5・OQ-C2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
  });

  it("ヘッダ検索から存在 id を検索すると詳細が表示され、complete は再生ナビを提供する（FR3.1/OQ-C2）", async () => {
    const user = userEvent.setup();
    // GET /videos/:videoId の既定ハンドラ = complete 動画（title: "サンプル動画"）。
    renderApp();

    await openSearchDialog(user);
    await user.type(screen.getByLabelText("動画 ID または YouTube URL"), "v1");
    await user.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByTestId("search-result")).toBeInTheDocument();
    expect(screen.getByText("サンプル動画")).toBeInTheDocument();
    // complete のみ再生ナビ（ルーター経由で U6 到達）。
    expect(screen.getByRole("button", { name: "再生ページへ" })).toBeInTheDocument();
  });

  it("存在しない id は「見つからない」旨を表示する（AC / error-path）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    renderApp();

    await openSearchDialog(user);
    await user.type(screen.getByLabelText("動画 ID または YouTube URL"), "missing");
    await user.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByText(/見つかりませんでした/)).toBeInTheDocument();
    expect(screen.queryByTestId("search-result")).not.toBeInTheDocument();
  });

  it("transport 失敗は error 表示にフォールバックする（error-path / FR8）", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    renderApp();

    await openSearchDialog(user);
    await user.type(screen.getByLabelText("動画 ID または YouTube URL"), "v1");
    await user.click(screen.getByRole("button", { name: "検索" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("通信");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
