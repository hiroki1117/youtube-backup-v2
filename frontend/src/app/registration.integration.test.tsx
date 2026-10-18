import { render, screen, waitFor } from "@testing-library/react";
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
import { TEST_API_BASE, makeRegistration } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

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

describe("動画登録 結合（ヘッダ→ダイアログ→登録 / US4.1・FR4.1・FR4.2・C5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
  });

  it("ヘッダの登録から有効 URL を送信すると success 通知が出て一覧が再取得される（US4.1/FR4.1/FR4.2）", async () => {
    const user = userEvent.setup();
    let getCount = 0;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => {
        getCount += 1;
        return HttpResponse.json([makeRawVideo({ title: "既存動画" })]);
      }),
      // POST /video は既定の成功ハンドラ（新規登録）を使用。
    );
    renderApp();
    await screen.findByText("既存動画");
    const initialGetCount = getCount;

    // ヘッダの登録アクション → ダイアログ表示（C5 openRegister）。
    await user.click(screen.getByRole("button", { name: "動画を登録" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.type(screen.getByLabelText("動画 URL"), "https://youtu.be/newvid");
    await user.click(screen.getByRole("button", { name: "登録" }));

    // success 通知（C4）。
    expect(await screen.findByText(/バックアップを開始しました/)).toBeInTheDocument();
    // 一覧 invalidate → GET 再取得（FR4.2）。
    await waitFor(() => expect(getCount).toBeGreaterThan(initialGetCount));
    // 登録受理でダイアログが閉じる。
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("無効 URL はフォーム内バリデーションを表示し API を呼ばない（error-path / NFR4）", async () => {
    const user = userEvent.setup();
    let posted = false;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ title: "既存動画" })]),
      ),
      http.post(`${TEST_API_BASE}/videos`, () => {
        posted = true;
        return HttpResponse.json(makeRegistration(), { status: 202 });
      }),
    );
    renderApp();
    await screen.findByText("既存動画");

    await user.click(screen.getByRole("button", { name: "動画を登録" }));
    await screen.findByRole("dialog");

    await user.type(screen.getByLabelText("動画 URL"), "notaurl");
    await user.click(screen.getByRole("button", { name: "登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("形式");
    expect(posted).toBe(false);
    // 検証失敗ではダイアログは開いたまま（再入力可能）。
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
