import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useLocation, useParams } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { presetRange } from "@/lib/search";
import { makeRawVideo } from "@/test/factories";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { server } from "@/test/server";
import { SearchPage } from "./SearchPage";

function PageWithLocation() {
  const { search } = useLocation();
  return (
    <>
      <SearchPage />
      <output data-testid="location">{search}</output>
    </>
  );
}

function DetailStub() {
  const { videoId } = useParams();
  return <div>詳細: {videoId}</div>;
}

function renderPage(entry = "/search") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/search", element: <PageWithLocation /> },
      { path: "/videos/:videoId", element: <DetailStub /> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** 検索 API の応答を固定し、受け取ったクエリを記録する。 */
function respondWith(items: ReturnType<typeof makeRawVideo>[], hasMore = false) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    http.get(`${TEST_API_BASE}/search/videos`, ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items, has_more: hasMore });
    }),
  );
  return requests;
}

const location = () => screen.getByTestId("location").textContent ?? "";

describe("SearchPage（U3 / US3.1・FR3.1）", () => {
  it("条件がなければ使い方を示し、すぐ入力できる", () => {
    renderPage();

    expect(screen.getByText(/タイトルの一部、動画 ID/)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "検索語" })).toHaveFocus();
  });

  it("語を確定すると URL に残し、結果を一覧と同じ行で表示する", async () => {
    respondWith([
      makeRawVideo({ video_id: "v1", title: "猫の動画" }),
      makeRawVideo({ video_id: "v2", title: "犬と猫" }),
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole("searchbox", { name: "検索語" }), "猫{Enter}");

    const list = await screen.findByRole("list", { name: "検索結果" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 件")).toBeInTheDocument();
    expect(location()).toBe("?q=%E7%8C%AB");
    // 一致部分を強調する。
    expect(list.querySelectorAll("mark")).toHaveLength(2);
  });

  it("URL の条件から検索を再現する（再読み込み・共有）", async () => {
    const requests = respondWith([makeRawVideo({ title: "猫の動画" })]);
    renderPage("/search?q=%E7%8C%AB&from=2026-08-01&to=2026-08-31");

    expect(await screen.findByRole("link", { name: /^猫の動画/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "検索語" })).toHaveValue("猫");
    expect(requests[0].get("backup_from")).toBe("2026-08-01");
    expect(requests[0].get("backup_to")).toBe("2026-08-31");
  });

  it("結果から動画を開いて戻ると同じ結果へ戻る", async () => {
    respondWith([makeRawVideo({ video_id: "v1", title: "猫の動画" })]);
    const user = userEvent.setup();
    const router = renderPage("/search?q=%E7%8C%AB");

    await user.click(await screen.findByRole("link", { name: /^猫の動画/ }));
    expect(await screen.findByText("詳細: v1")).toBeInTheDocument();

    await router.navigate(-1);

    expect(await screen.findByRole("list", { name: "検索結果" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "検索語" })).toHaveValue("猫");
  });

  it("期間のチップを押すだけで検索する（語なしでもよい）", async () => {
    const requests = respondWith([makeRawVideo({ title: "今年の動画" })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "今年" }));

    expect(await screen.findByText("今年の動画", { exact: false })).toBeInTheDocument();
    const range = presetRange("thisYear", new Date());
    expect(requests[0].get("backup_from")).toBe(range.from);
    expect(requests[0].has("q")).toBe(false);
    expect(screen.getByRole("button", { name: "今年" })).toHaveAttribute("aria-pressed", "true");
  });

  it("「すべて」で期間を解除する", async () => {
    respondWith([makeRawVideo()]);
    const user = userEvent.setup();
    renderPage("/search?q=cat&from=2026-08-01&to=2026-08-31");

    await user.click(screen.getByRole("button", { name: "すべて" }));

    await waitFor(() => expect(location()).toBe("?q=cat"));
  });

  it("手で指定した範囲は入力欄を開いた状態で表示する", () => {
    respondWith([]);
    renderPage("/search?from=2026-08-01&to=2026-08-31");

    expect(screen.getByLabelText("開始日")).toHaveValue("2026-08-01");
    expect(screen.getByLabelText("終了日")).toHaveValue("2026-08-31");
  });

  it("「期間を指定」で日付を入力すると、逆順でも検索する", async () => {
    const requests = respondWith([makeRawVideo({ title: "日付の動画" })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "期間を指定" }));
    await user.type(screen.getByLabelText("開始日"), "2026-08-31");
    await user.type(screen.getByLabelText("終了日"), "2026-08-01");

    await waitFor(() => expect(location()).toBe("?from=2026-08-01&to=2026-08-31"));
    await waitFor(() => expect(requests.at(-1)?.get("backup_to")).toBe("2026-08-31"));
  });

  it("上限を超えたら、条件を絞るよう案内する", async () => {
    respondWith(
      [makeRawVideo({ video_id: "v1" }), makeRawVideo({ video_id: "v2", title: "別" })],
      true,
    );
    renderPage("/search?q=%E7%8C%AB%20%E7%8A%AC");

    expect(await screen.findByText("2 件以上")).toBeInTheDocument();
    expect(screen.getByText(/語を足すか期間を絞る/)).toBeInTheDocument();
  });

  it("該当なしは次の行動を示し、条件をクリアできる", async () => {
    respondWith([]);
    const user = userEvent.setup();
    renderPage("/search?q=cat&from=2026-08-01");

    expect(await screen.findByText("該当する動画はありません")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "条件をクリア" }));

    await waitFor(() => expect(location()).toBe(""));
    expect(screen.getByRole("searchbox", { name: "検索語" })).toHaveValue("");
    expect(screen.getByText(/タイトルの一部、動画 ID/)).toBeInTheDocument();
  });

  it("× で語だけを消し、期間は残す", async () => {
    respondWith([makeRawVideo()]);
    const user = userEvent.setup();
    renderPage("/search?q=cat&from=2026-08-01");

    await user.click(await screen.findByRole("button", { name: "検索語を消す" }));

    await waitFor(() => expect(location()).toBe("?from=2026-08-01"));
  });

  it("URL から動画を特定できなければ入力エラーを示す", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByRole("searchbox", { name: "検索語" }),
      "https://example.com/x{Enter}",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("動画 ID を特定できませんでした");
    expect(screen.getByRole("searchbox", { name: "検索語" })).toBeInvalid();
  });

  it("通信に失敗したら再試行できる（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/search/videos`, () => HttpResponse.error()));
    renderPage("/search?from=2026-08-01");

    expect(await screen.findByRole("alert")).toHaveTextContent("通信");
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
