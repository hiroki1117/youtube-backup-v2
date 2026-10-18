import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 認証は AuthModule をモックして制御（Cognito ネットワークに出ない）。
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
import { TEST_API_BASE } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

function renderApp(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe("AppShell 結合（WF1-WF4 / AC1.1.x / AC7.1.x）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証で保護ルート（/videos）にアクセスすると /login へリダイレクトする（AC1.1.1 / AC1.2.2）", async () => {
    getSessionMock.mockResolvedValue("unauthenticated");
    renderApp(["/videos"]);
    expect(await screen.findByRole("form", { name: "ログインフォーム" })).toBeInTheDocument();
  });

  it("ログイン成功で /videos へ遷移し一覧が描画される（AC1.1.2 / AC7.1.1）", async () => {
    const user = userEvent.setup();
    getSessionMock.mockResolvedValue("unauthenticated");
    signInMock.mockResolvedValue({ kind: "ok" });
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ title: "疎通テスト動画" })]),
      ),
    );

    renderApp(["/login"]);
    await screen.findByRole("form", { name: "ログインフォーム" });

    await user.type(screen.getByLabelText("ユーザー名"), "user");
    await user.type(screen.getByLabelText("パスワード"), "password");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText("疎通テスト動画")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith("user", "password");
  });

  it("認証失敗時はエラー通知が表示され /login に留まる（AC1.1.3）", async () => {
    const user = userEvent.setup();
    getSessionMock.mockResolvedValue("unauthenticated");
    signInMock.mockResolvedValue({
      kind: "invalidCredentials",
      message: "認証情報が正しくありません",
    });

    renderApp(["/login"]);
    await screen.findByRole("form", { name: "ログインフォーム" });

    await user.type(screen.getByLabelText("ユーザー名"), "user");
    await user.type(screen.getByLabelText("パスワード"), "wrong");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    // エラーはフォーム上部（role=alert）とトースト通知の双方に表示される（WF1 step7）
    const alerts = await screen.findAllByText("認証情報が正しくありません");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("form", { name: "ログインフォーム" })).toBeInTheDocument();
  });

  it("認証済みで一覧取得が transport 失敗するとエラー UI（再試行）を描画する（AC7.1.2 / AC7.1.4）", async () => {
    getSessionMock.mockResolvedValue("authenticated");
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.error()));

    renderApp(["/videos"]);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("認証済みで一覧が 0 件なら空状態を描画する（AC7.1.3）", async () => {
    getSessionMock.mockResolvedValue("authenticated");
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json([])));

    renderApp(["/videos"]);

    expect(await screen.findByText("バックアップ済み動画がありません")).toBeInTheDocument();
  });

  it("認証済みなら AppShell ヘッダにログアウト操作が表示される（AC1.2.1）", async () => {
    getSessionMock.mockResolvedValue("authenticated");
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json([])));

    renderApp(["/videos"]);

    expect(await screen.findByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });
});
