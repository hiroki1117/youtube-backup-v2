import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/Toaster";
import { VideoPlaybackPage } from "@/app/VideoPlaybackPage";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

/** タイトル編集（再生ページのインライン編集 → PATCH /videos/{id}）のテスト。 */

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/videos/v1"]}>
        <Routes>
          <Route path="/videos/:videoId" element={<VideoPlaybackPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("動画タイトル編集", () => {
  it("編集→保存で PATCH され、見出しが新しいタイトルになり success 通知が出る", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.patch(`${TEST_API_BASE}/videos/:videoId`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeRawVideo({ title: "新しいタイトル" }));
      }),
    );
    renderPage();

    await user.click(await screen.findByTestId("title-edit-button"));
    const input = screen.getByTestId("title-input");
    expect(input).toHaveValue("サンプル動画");
    await user.clear(input);
    await user.type(input, "  新しいタイトル  ");
    await user.click(screen.getByTestId("title-save-button"));

    await waitFor(() =>
      expect(screen.getByTestId("playback-heading")).toHaveTextContent("新しいタイトル"),
    );
    expect(body).toEqual({ title: "新しいタイトル" });
    expect(screen.queryByTestId("title-editor")).not.toBeInTheDocument();
    expect(await screen.findByText("タイトルを更新しました")).toBeInTheDocument();
  });

  it("未変更・空白のみの間は保存できず、Esc で破棄できる", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("title-edit-button"));
    expect(screen.getByTestId("title-save-button")).toBeDisabled();
    await user.clear(screen.getByTestId("title-input"));
    await user.type(screen.getByTestId("title-input"), "   ");
    expect(screen.getByTestId("title-save-button")).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("title-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("playback-heading")).toHaveTextContent("サンプル動画");
  });

  it("保存失敗は error 通知を出し、編集状態と入力内容を保持する（error-path）", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    renderPage();

    await user.click(await screen.findByTestId("title-edit-button"));
    await user.clear(screen.getByTestId("title-input"));
    await user.type(screen.getByTestId("title-input"), "失敗するタイトル");
    await user.click(screen.getByTestId("title-save-button"));

    expect(await screen.findByText("動画が見つかりません。")).toBeInTheDocument();
    expect(screen.getByTestId("title-input")).toHaveValue("失敗するタイトル");
  });
});
