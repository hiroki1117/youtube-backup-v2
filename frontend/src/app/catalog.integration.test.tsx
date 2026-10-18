import { render, screen, waitFor, within } from "@testing-library/react";
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
import { TEST_API_BASE } from "@/test/handlers";
import { makeRawVideo, makeRawVideos } from "@/test/factories";

function renderApp(initialEntries: string[] = ["/videos"]) {
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

function rowTitles(): string[] {
  const list = screen.getByRole("list", { name: "動画一覧" });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

describe("VideoCatalog 結合（/videos / FR2.1〜2.4・FR8・US2.1〜2.5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
  });

  it("/videos で状態別一覧を描画する（既定 complete・desc）（US2.1 / AC FR2.1）", async () => {
    // 既定ハンドラ: complete = 完了動画1(08-01)/完了動画2(08-03)/完了動画3(08-02)
    renderApp();
    expect(await screen.findByRole("list", { name: "動画一覧" })).toBeInTheDocument();
    // desc 既定 → 完了動画2(08-03), 完了動画3(08-02), 完了動画1(08-01)
    const titles = rowTitles();
    expect(titles[0]).toContain("完了動画2");
    expect(titles[1]).toContain("完了動画3");
    expect(titles[2]).toContain("完了動画1");
  });

  it("状態フィルタを init へ切り替えると処理中一覧へ再取得する（US2.2 / FR2.2）", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("完了動画2");

    await user.click(screen.getByRole("button", { name: "処理中" }));

    // init = 処理中動画1(07-20)/処理中動画2(07-25)
    expect(await screen.findByText("処理中動画2")).toBeInTheDocument();
    expect(screen.getByText("処理中動画1")).toBeInTheDocument();
    expect(screen.queryByText("完了動画2")).not.toBeInTheDocument();
  });

  it("ソート順トグルで並びが反転する（US2.3 / FR2.3）", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("完了動画2");
    expect(rowTitles()[0]).toContain("完了動画2"); // desc 先頭

    await user.click(screen.getByRole("button", { name: /並び順を切り替え/ }));

    // asc → 完了動画1(08-01) が先頭
    await waitFor(() => expect(rowTitles()[0]).toContain("完了動画1"));
    expect(rowTitles()[2]).toContain("完了動画2");
  });

  it("「もっと見る」で続きの行を追加表示し、末尾まで取得したらボタンを消す（旧版と同じ more 方式）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        const n = Number(new URL(request.url).searchParams.get("fetch_num"));
        return HttpResponse.json(makeRawVideos(60).slice(0, n));
      }),
    );
    renderApp();

    await screen.findByRole("list", { name: "動画一覧" });
    expect(
      within(screen.getByRole("list", { name: "動画一覧" })).getAllByRole("listitem"),
    ).toHaveLength(50);

    await user.click(screen.getByRole("button", { name: "もっと見る" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "動画一覧" })).getAllByRole("listitem"),
      ).toHaveLength(60),
    );
    expect(screen.queryByRole("button", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("手動更新で一覧を再取得する（US2.5）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ title: "更新前" })]),
      ),
    );
    renderApp();
    await screen.findByText("更新前");

    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ video_id: "v2", title: "更新後" })]),
      ),
    );
    await user.click(screen.getByRole("button", { name: "一覧を更新" }));

    expect(await screen.findByText("更新後")).toBeInTheDocument();
  });

  it("フィルタ結果 0 件で empty:filtered を描画する（FR8）", async () => {
    const user = userEvent.setup();
    // complete = データあり、init = 空（フィルタ適用で 0 件 → empty:filtered）
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        const status = new URL(request.url).searchParams.get("upload_status");
        return HttpResponse.json(status === "init" ? [] : [makeRawVideo({ title: "完了動画X" })]);
      }),
    );
    renderApp();
    await screen.findByText("完了動画X");

    await user.click(screen.getByRole("button", { name: "処理中" }));

    expect(await screen.findByText("条件に一致するデータがありません")).toBeInTheDocument();
  });

  it("取得失敗で error UI（再試行）を描画する（FR8 error-path）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.error()));
    renderApp();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
