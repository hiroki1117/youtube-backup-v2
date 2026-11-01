import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useLocation, useParams } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTERS, presetRange, type SearchFilters } from "@/lib/search";
import { createEntry, parseEntries } from "@/lib/searchHistory";
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

describe("SearchPage の検索履歴", () => {
  const historyList = () => screen.findByRole("list", { name: "検索履歴" });
  const searchBox = () => screen.getByRole("searchbox", { name: "検索語" });

  /** 別の日に行った検索として履歴を用意する。 */
  function seedHistory(...filters: Partial<SearchFilters>[]) {
    const entries = filters.map((filter) =>
      createEntry({ ...EMPTY_FILTERS, ...filter }, [], new Date(2026, 0, 1)),
    );
    localStorage.setItem("searchHistory", JSON.stringify(entries));
  }

  const storedTexts = () =>
    parseEntries(localStorage.getItem("searchHistory") ?? "[]").map(({ text }) => text);

  it("結果の出た検索を残し、次に開いたときは検索欄の下から 1 回で検索できる", async () => {
    const requests = respondWith([makeRawVideo({ title: "猫の動画" })]);
    const user = userEvent.setup();
    renderPage();

    await user.type(searchBox(), "猫{Enter}");
    await screen.findByRole("list", { name: "検索結果" });
    cleanup();

    renderPage();
    await user.click(within(await historyList()).getByRole("button", { name: "猫 を検索" }));

    expect(await screen.findByRole("list", { name: "検索結果" })).toBeInTheDocument();
    expect(location()).toBe("?q=%E7%8C%AB");
    expect(searchBox()).toHaveValue("猫");
    expect(requests).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "検索履歴" })).not.toBeInTheDocument();
  });

  it("履歴があれば使い方の代わりに履歴を出す", async () => {
    seedHistory({ text: "猫" });
    renderPage();

    expect(await historyList()).toBeInTheDocument();
    expect(screen.queryByText(/タイトルの一部、動画 ID/)).not.toBeInTheDocument();
  });

  it("該当なしの検索は残さない", async () => {
    respondWith([]);
    const user = userEvent.setup();
    renderPage();

    await user.type(searchBox(), "ねこｍ{Enter}");
    await screen.findByText("該当する動画はありません");

    expect(storedTexts()).toEqual([]);
  });

  it("失敗したあと再試行で結果が出れば残す", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
      http.get(`${TEST_API_BASE}/search/videos`, () => HttpResponse.error(), { once: true }),
      http.get(`${TEST_API_BASE}/search/videos`, () =>
        HttpResponse.json({ items: [makeRawVideo()], has_more: false }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(searchBox(), "猫{Enter}");
    await user.click(await screen.findByRole("button", { name: "再試行" }));

    await waitFor(() => expect(storedTexts()).toEqual(["猫"]));
  });

  it("URL で開いた検索は残さない（戻る・再読み込み・共有リンク）", async () => {
    respondWith([makeRawVideo({ title: "猫の動画" })]);
    renderPage("/search?q=%E7%8C%AB");

    await screen.findByRole("list", { name: "検索結果" });

    expect(storedTexts()).toEqual([]);
  });

  it("期間チップを続けて押しても、最後の期間だけを残す", async () => {
    respondWith([makeRawVideo()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "今年" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "今年" })).toHaveAttribute("aria-pressed", "true"),
    );
    await screen.findByRole("list", { name: "検索結果" });
    await user.click(screen.getByRole("button", { name: "去年" }));

    await waitFor(() => {
      const [entry, ...rest] = parseEntries(localStorage.getItem("searchHistory") ?? "[]");
      expect(entry?.preset).toBe("lastYear");
      expect(rest).toEqual([]);
    });
  });

  it("結果の表示中は検索欄へフォーカスすると履歴を出し、Esc や外へ移ると閉じる", async () => {
    respondWith([makeRawVideo()]);
    seedHistory({ text: "犬" }, { text: "猫" });
    const user = userEvent.setup();
    renderPage("/search?q=%E7%8C%AB");
    await screen.findByRole("list", { name: "検索結果" });
    expect(screen.queryByRole("list", { name: "検索履歴" })).not.toBeInTheDocument();

    await user.click(searchBox());
    expect(within(await historyList()).getAllByRole("listitem")).toHaveLength(2);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "検索履歴" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "すべて" }));
    await user.click(searchBox());
    await historyList();
    await user.click(document.body);
    expect(screen.queryByRole("list", { name: "検索履歴" })).not.toBeInTheDocument();
  });

  it("行を押した瞬間に検索欄のフォーカスを奪わず、検索できる", async () => {
    respondWith([makeRawVideo()]);
    seedHistory({ text: "犬" });
    const user = userEvent.setup();
    renderPage("/search?from=2026-08-01");
    await screen.findByRole("list", { name: "検索結果" });

    await user.click(searchBox());
    await user.click(await screen.findByRole("button", { name: "犬 を検索" }));

    await waitFor(() => expect(location()).toBe("?q=%E7%8A%AC"));
  });

  it("Tab で履歴の行へ移っても閉じない", async () => {
    respondWith([makeRawVideo()]);
    seedHistory({ text: "犬" });
    const user = userEvent.setup();
    renderPage("/search?from=2026-08-01");
    await screen.findByRole("list", { name: "検索結果" });

    await user.click(searchBox());
    await user.tab();
    await user.tab();

    expect(await screen.findByRole("button", { name: "すべて削除" })).toHaveFocus();
  });

  it("入力中はその語を含む履歴に絞り、絞り込み中は「すべて削除」を出さない", async () => {
    seedHistory({ text: "猫 まとめ" }, { text: "犬" });
    const user = userEvent.setup();
    renderPage();

    await user.type(searchBox(), "猫");

    const list = await historyList();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("button", { name: "猫 まとめ を検索" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "すべて削除" })).not.toBeInTheDocument();
  });

  it("手で指定した範囲の履歴を選ぶと、期間の入力欄を開いて示す", async () => {
    respondWith([makeRawVideo()]);
    seedHistory({ text: "猫", from: "2026-08-01", to: "2026-08-31" });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "猫、2026/8/1〜8/31にバックアップ を検索" }),
    );

    expect(await screen.findByLabelText("開始日")).toHaveValue("2026-08-01");
  });

  it("履歴を 1 件ずつ消せる", async () => {
    seedHistory({ text: "猫" }, { text: "犬" });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "猫 を履歴から削除" }));

    expect(screen.queryByRole("button", { name: "猫 を検索" })).not.toBeInTheDocument();
    expect(storedTexts()).toEqual(["犬"]);
  });

  it("キーボードで消しても検索欄の周辺にフォーカスが残る", async () => {
    seedHistory({ text: "猫" }, { text: "犬" });
    const user = userEvent.setup();
    renderPage();

    (await screen.findByRole("button", { name: "猫 を履歴から削除" })).focus();
    await user.keyboard("{Enter}");

    expect(await historyList()).toHaveFocus();
  });

  it("すべて削除は確認してから消し、やめることもできる", async () => {
    seedHistory({ text: "猫" });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "すべて削除" }));
    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(storedTexts()).toEqual(["猫"]);

    await user.click(screen.getByRole("button", { name: "すべて削除" }));
    await user.click(screen.getByRole("button", { name: "本当に削除" }));

    expect(storedTexts()).toEqual([]);
    expect(screen.queryByRole("list", { name: "検索履歴" })).not.toBeInTheDocument();
    expect(screen.getByText(/タイトルの一部、動画 ID/)).toBeInTheDocument();
  });

  it("保存できない環境でも検索は続けられる", async () => {
    respondWith([makeRawVideo()]);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(searchBox(), "猫{Enter}");

    expect(await screen.findByRole("list", { name: "検索結果" })).toBeInTheDocument();
    setItem.mockRestore();
  });
});
