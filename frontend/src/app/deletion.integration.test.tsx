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
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
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

describe("動画削除 結合（行→確認→削除 / US5.1・FR5.1・C4・C6・R-02）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue("authenticated");
  });

  it("行の削除→確認→確定で行が一覧から消え success 通知が出る（US5.1/FR5.1）", async () => {
    const user = userEvent.setup();
    let videos = [
      makeRawVideo({ video_id: "c1", title: "削除対象動画" }),
      makeRawVideo({ video_id: "c2", title: "残る動画" }),
    ];
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json(videos)),
      http.delete(`${TEST_API_BASE}/videos/:videoId`, ({ params }) => {
        const id = String(params.videoId);
        videos = videos.filter((v) => v.video_id !== id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp();
    await screen.findByText("削除対象動画");

    // 行の削除ボタン（C6 onDelete）→ 確認ダイアログ（FR5.1）。
    await user.click(screen.getByRole("button", { name: "削除: 削除対象動画" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "削除する" }));

    // success 通知（C4）。
    expect(await screen.findByText(/動画を削除しました/)).toBeInTheDocument();
    // invalidate → 再取得で対象行が一覧から消える。残る動画は残存する。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "削除: 削除対象動画" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "削除: 残る動画" })).toBeInTheDocument();
    // 確認ダイアログは閉じる。
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("確認が必要な処理中（init）動画の取り消しは拒否通知が出て一覧は変化しない（R-02 / error-path）", async () => {
    const user = userEvent.setup();
    let getCount = 0;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => {
        getCount += 1;
        return HttpResponse.json([
          makeRawVideo({ video_id: "i1", title: "処理中動画", upload_status: "init" }),
        ]);
      }),
      http.delete(`${TEST_API_BASE}/videos/:videoId/backup`, () =>
        errorResponse(409, "backup_object_needs_reconciliation"),
      ),
    );
    renderApp();
    await screen.findByText("処理中動画");
    const getCountAfterLoad = getCount;

    await user.click(screen.getByRole("button", { name: "取り消し: 処理中動画" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "取り消す" }));

    // 拒否通知（C4）。
    expect(await screen.findByText(/削除・取り消しできません/)).toBeInTheDocument();
    // ダイアログは閉じるが、一覧は不変（行が残る）。
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "取り消し: 処理中動画" })).toBeInTheDocument();
    // 拒否時は invalidate（再取得）が発生しない。
    expect(getCount).toBe(getCountAfterLoad);
  });

  it("処理中（init）動画を取り消すと行が消え、取り消しの success 通知が出る", async () => {
    const user = userEvent.setup();
    let videos = [
      makeRawVideo({ video_id: "i1", title: "処理中動画", upload_status: "init" }),
      makeRawVideo({ video_id: "i2", title: "別の処理中動画", upload_status: "init" }),
    ];
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json(videos)),
      http.delete(`${TEST_API_BASE}/videos/:videoId/backup`, ({ params }) => {
        videos = videos.filter((v) => v.video_id !== String(params.videoId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp();
    await screen.findByText("処理中動画");

    await user.click(screen.getByRole("button", { name: "取り消し: 処理中動画" }));
    expect(await screen.findByText("バックアップを取り消し")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取り消す" }));

    expect(await screen.findByText(/バックアップを取り消しました/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "取り消し: 処理中動画" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "取り消し: 別の処理中動画" })).toBeInTheDocument();
  });

  it("transport 失敗は error 通知が出て一覧は変化しない（error-path / FR8）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo({ video_id: "c1", title: "完了動画" })]),
      ),
      http.delete(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()),
    );
    renderApp();
    await screen.findByText("完了動画");

    await user.click(screen.getByRole("button", { name: "削除: 完了動画" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "削除する" }));

    // error 通知（C4 / FR8）。
    expect(await screen.findByText(/通信に失敗/)).toBeInTheDocument();
    // 一覧は不変（行が残る）。
    expect(screen.getByRole("button", { name: "削除: 完了動画" })).toBeInTheDocument();
  });
});
