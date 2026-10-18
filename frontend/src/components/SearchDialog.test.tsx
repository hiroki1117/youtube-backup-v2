import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useParams } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";
import { SearchDialog } from "./SearchDialog";

/** 再生ページの代替。遷移先 videoId を可視化して検証する。 */
function PlaybackStub() {
  const { videoId } = useParams();
  return <div>再生ページ: {videoId}</div>;
}

function renderDialog(onClose: () => void = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/", element: <SearchDialog open onClose={onClose} /> },
      { path: "/videos/:videoId", element: <PlaybackStub /> },
    ],
    { initialEntries: ["/"] },
  );
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

async function submitSearch(user: ReturnType<typeof userEvent.setup>, input: string) {
  await user.type(screen.getByLabelText("動画 ID または YouTube URL"), input);
  await user.click(screen.getByRole("button", { name: "検索" }));
}

describe("SearchDialog（U3 / US3.1・FR3.1・C4・C5・OQ-C2）", () => {
  it("dialog の role/aria を備える（アクセシビリティ）", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("動画を検索");
    expect(screen.getByRole("form", { name: "動画検索フォーム" })).toBeInTheDocument();
  });

  it("検索してフックが getVideo を呼び、ready で動画詳細を表示する（happy path）", async () => {
    const user = userEvent.setup();
    const getSpy = vi.spyOn(apiClient, "getVideo");
    renderDialog();

    await submitSearch(user, "v1");

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith("v1"));
    expect(await screen.findByTestId("search-result")).toBeInTheDocument();
    // 既定ハンドラ = complete 動画（title: "サンプル動画"）。
    expect(screen.getByText("サンプル動画")).toBeInTheDocument();
    getSpy.mockRestore();
  });

  it("complete 動画は「再生ページへ」を表示し、押下で /videos/:videoId へ遷移する（OQ-C2）", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(onClose);

    await submitSearch(user, "v1");

    const playButton = await screen.findByRole("button", { name: "再生ページへ" });
    await user.click(playButton);

    // ルーター経由で U6（再生ページ）へ到達（video_id: "v1"）。
    expect(await screen.findByText("再生ページ: v1")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("init 動画では「再生ページへ」を表示しない（complete のみ再生提供）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ video_id: "i1", upload_status: "init" })),
      ),
    );
    const user = userEvent.setup();
    renderDialog();

    await submitSearch(user, "i1");

    // 詳細は表示されるが再生ナビは出ない。
    expect(await screen.findByTestId("search-result")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再生ページへ" })).not.toBeInTheDocument();
  });

  it("存在しない video_id は「見つからない」旨を表示する（error-path / FR3.1）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    const user = userEvent.setup();
    renderDialog();

    await submitSearch(user, "missing");

    expect(await screen.findByText(/見つかりませんでした/)).toBeInTheDocument();
    expect(screen.queryByTestId("search-result")).not.toBeInTheDocument();
  });

  it("transport 失敗は error 表示と再試行を出す（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const user = userEvent.setup();
    renderDialog();

    await submitSearch(user, "v1");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("通信");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("空入力のまま検索すると API を呼ばずバリデーション表示する（US3.1）", async () => {
    const user = userEvent.setup();
    const getSpy = vi.spyOn(apiClient, "getVideo");
    renderDialog();

    await user.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("入力してください");
    expect(getSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("search-result")).not.toBeInTheDocument();
    getSpy.mockRestore();
  });

  it("閉じるで onClose が呼ばれる", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(onClose);

    await user.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
