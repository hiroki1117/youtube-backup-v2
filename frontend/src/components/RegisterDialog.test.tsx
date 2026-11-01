import { StrictMode, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { server } from "@/test/server";
import { TEST_API_BASE, makeRegistration } from "@/test/handlers";
import { RegisterDialog } from "./RegisterDialog";

function renderDialog(onClose: () => void = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RegisterDialog open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

function renderToggleableDialog() {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>再表示</button>
        <button onClick={() => setOpen(false)}>親から閉じる</button>
        <RegisterDialog open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    </StrictMode>,
  );
}

function deferredClipboardRead() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("RegisterDialog（U4 / US4.1）", () => {
  it("dialog の role/aria を備える（アクセシビリティ）", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // aria-labelledby がタイトルを参照している。
    expect(dialog).toHaveAccessibleName("動画を登録");
    expect(screen.getByRole("form", { name: "動画登録フォーム" })).toBeInTheDocument();
  });

  it("有効 URL を入力して送信するとフックが submitVideo を呼び、登録受理で閉じる（US4.1）", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    const onClose = vi.fn();
    renderDialog(onClose);

    await user.type(screen.getByLabelText("動画 URL"), "https://youtu.be/abc123");
    await user.click(screen.getByRole("button", { name: "登録" }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith("https://youtu.be/abc123"));
    // 既定ハンドラ = 新規登録成功 → onRegistered → onClose。
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    submitSpy.mockRestore();
  });

  it("無効 URL（http:）はバリデーション表示し API を呼ばない（NFR4 / サーバー往復回避）", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await user.type(screen.getByLabelText("動画 URL"), "http://example.com/video");
    await user.click(screen.getByRole("button", { name: "登録" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("https");
    expect(submitSpy).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });

  it("空 URL のまま送信するとバリデーション表示し API を呼ばない", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await user.click(screen.getByRole("button", { name: "登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("入力");
    expect(submitSpy).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });

  it("送信中は送信ボタンが無効化される（二重送信抑止 / US4.1）", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${TEST_API_BASE}/videos`, async () => {
        await delay(80);
        return HttpResponse.json(makeRegistration(), { status: 202 });
      }),
    );
    renderDialog();

    await user.type(screen.getByLabelText("動画 URL"), "https://youtu.be/abc123");
    await user.click(screen.getByRole("button", { name: "登録" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "登録" })).toBeDisabled());
  });

  it("キャンセルで onClose が呼ばれる", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog(onClose);

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterDialog のクリップボードから登録", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["キャンセル", "親から閉じる"])(
    "%s 後に読み取りが完了しても登録しない",
    async (closeButton) => {
      const user = userEvent.setup();
      const read = deferredClipboardRead();
      vi.spyOn(navigator.clipboard, "readText").mockReturnValue(read.promise);
      const submitSpy = vi.spyOn(apiClient, "submitVideo").mockResolvedValue({ kind: "empty" });
      renderToggleableDialog();

      await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
      await user.click(screen.getByRole("button", { name: closeButton }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await act(async () => read.resolve("https://youtu.be/cancelled"));

      expect(submitSpy).not.toHaveBeenCalled();
    },
  );

  it("再表示後は前回の読み取りを無視し、新しい読み取りだけを登録する", async () => {
    const user = userEvent.setup();
    const oldRead = deferredClipboardRead();
    const newRead = deferredClipboardRead();
    vi.spyOn(navigator.clipboard, "readText")
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const submitSpy = vi.spyOn(apiClient, "submitVideo").mockResolvedValue({ kind: "empty" });
    renderToggleableDialog();

    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "再表示" }));
    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
    await act(async () => oldRead.resolve("https://youtu.be/old"));
    expect(submitSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("動画 URL")).toHaveValue("");

    await act(async () => newRead.resolve("https://youtu.be/new"));
    expect(submitSpy).toHaveBeenCalledExactlyOnceWith("https://youtu.be/new");
  });

  it.each(["resolve", "reject"] as const)(
    "連続読み取りでは古い結果（%s）を無視する",
    async (settlement) => {
      const user = userEvent.setup();
      const oldRead = deferredClipboardRead();
      const newRead = deferredClipboardRead();
      vi.spyOn(navigator.clipboard, "readText")
        .mockReturnValueOnce(oldRead.promise)
        .mockReturnValueOnce(newRead.promise);
      const submitSpy = vi.spyOn(apiClient, "submitVideo").mockResolvedValue({ kind: "empty" });
      renderToggleableDialog();

      await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
      await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
      await act(async () => newRead.resolve("https://youtu.be/new"));
      await act(async () => {
        if (settlement === "resolve") oldRead.resolve("https://youtu.be/old");
        else oldRead.reject(new Error("denied"));
      });

      expect(submitSpy).toHaveBeenCalledExactlyOnceWith("https://youtu.be/new");
      expect(screen.getByLabelText("動画 URL")).toHaveValue("https://youtu.be/new");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("読み取り待ちに手入力で登録したら、古い読み取りから登録しない", async () => {
    const user = userEvent.setup();
    const read = deferredClipboardRead();
    vi.spyOn(navigator.clipboard, "readText").mockReturnValue(read.promise);
    const submitSpy = vi.spyOn(apiClient, "submitVideo").mockResolvedValue({ kind: "empty" });
    renderToggleableDialog();
    await user.type(screen.getByLabelText("動画 URL"), "https://youtu.be/manual");
    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));
    await user.click(screen.getByRole("button", { name: "登録" }));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledOnce());
    await act(async () => read.resolve("https://youtu.be/old"));

    expect(submitSpy).toHaveBeenCalledExactlyOnceWith("https://youtu.be/manual");
  });

  it("開いたら URL 入力欄にフォーカスする", () => {
    renderDialog();
    expect(screen.getByLabelText("動画 URL")).toHaveFocus();
  });

  it("クリップボードの URL をそのまま送信し、受理で閉じる", async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText("  https://youtu.be/fromclip  ");
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    const onClose = vi.fn();
    renderDialog(onClose);

    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith("https://youtu.be/fromclip"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("クリップボードが URL でなければ送信せず、入力欄に残して理由を出す", async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText("not a url");
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("形式");
    expect(screen.getByLabelText("動画 URL")).toHaveValue("not a url");
    expect(screen.getByLabelText("動画 URL")).toHaveFocus();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("クリップボードを読めなければ手入力を促し、入力欄にフォーカスする", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValue(new Error("denied"));
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("貼り付けてください");
    expect(screen.getByLabelText("動画 URL")).toHaveFocus();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

describe("RegisterDialog の再生リストからの登録", () => {
  const PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLtest";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openPreview(user: ReturnType<typeof userEvent.setup>, url = PLAYLIST_URL) {
    await user.type(screen.getByLabelText("動画 URL"), url);
    await user.click(screen.getByRole("button", { name: "登録" }));
    return screen.findByRole("list", { name: "登録する動画" });
  }

  it("再生リストの URL は登録せずに中身を見せ、確定すると 1 本ずつ順に登録して結果を出す", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    const onClose = vi.fn();
    renderDialog(onClose);

    const list = await openPreview(user);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("再生リストを登録");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["再生リストの動画1", "再生リストの動画2", "再生リストの動画3"]);
    expect(screen.getByText(/非公開・削除済みの 1 本/)).toBeInTheDocument();
    expect(submitSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "3 本を登録" }));

    const result = await screen.findByRole("list", { name: "登録の結果" });
    expect(result).toHaveTextContent("バックアップを開始: 3 本");
    expect(result).toHaveTextContent("登録済み: 0 本");
    expect(result).toHaveTextContent("失敗: 0 本");
    expect(submitSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://www.youtube.com/watch?v=pv1",
      "https://www.youtube.com/watch?v=pv2",
      "https://www.youtube.com/watch?v=pv3",
    ]);
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("登録済み・失敗を数え分け、失敗した動画は理由とともに出す", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${TEST_API_BASE}/videos`, async ({ request }) => {
        const { url } = (await request.json()) as { url: string };
        if (url.endsWith("pv1")) {
          return HttpResponse.json(makeRegistration({ already_registered: true }));
        }
        if (url.endsWith("pv2")) {
          return HttpResponse.json({ detail: "invalid_youtube_id" }, { status: 422 });
        }
        return HttpResponse.json(makeRegistration(), { status: 202 });
      }),
    );
    renderDialog();

    await openPreview(user);
    await user.click(screen.getByRole("button", { name: "3 本を登録" }));

    const result = await screen.findByRole("list", { name: "登録の結果" });
    expect(result).toHaveTextContent("バックアップを開始: 1 本");
    expect(result).toHaveTextContent("登録済み: 1 本");
    expect(result).toHaveTextContent("失敗: 1 本");
    const failed = screen.getByRole("list", { name: "登録できなかった動画" });
    expect(failed).toHaveTextContent("再生リストの動画2");
    expect(failed).toHaveTextContent("YouTube の動画 URL として認識できません。");
  });

  it("中止すると実行中の 1 本で止め、残りを登録しない", async () => {
    const user = userEvent.setup();
    let posted = 0;
    // 1 本目の応答を、中止を押すまで返さない。
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${TEST_API_BASE}/videos`, async () => {
        posted += 1;
        await released;
        return HttpResponse.json(makeRegistration(), { status: 202 });
      }),
    );
    renderDialog();

    await openPreview(user);
    await user.click(screen.getByRole("button", { name: "3 本を登録" }));
    expect(await screen.findByText("登録しています… 0 / 3 本")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "中止" }));
    release();

    expect(await screen.findByText(/途中で中止したため、残りの 2 本/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "登録の結果" })).toHaveTextContent(
      "バックアップを開始: 1 本",
    );
    expect(posted).toBe(1);
  });

  it("戻ると入力に戻り、何も登録しない", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await openPreview(user);
    await user.click(screen.getByRole("button", { name: "戻る" }));

    expect(screen.getByLabelText("動画 URL")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("動画を登録");
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("読み込めない再生リストは入力欄に理由を出す", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_BASE}/youtube/playlist`, () =>
        HttpResponse.json({ detail: "playlist_not_found" }, { status: 404 }),
      ),
    );
    renderDialog();

    await user.type(screen.getByLabelText("動画 URL"), PLAYLIST_URL);
    await user.click(screen.getByRole("button", { name: "登録" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("再生リストが見つかりません");
    expect(screen.getByLabelText("動画 URL")).toHaveFocus();
  });

  it("再生中の動画に再生リストが付いた URL は、動画 1 本として登録する", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    const playlistSpy = vi.spyOn(apiClient, "getYoutubePlaylist");
    const onClose = vi.fn();
    renderDialog(onClose);
    const url = "https://www.youtube.com/watch?v=abcdefghijk&list=PLtest&index=2";

    await user.type(screen.getByLabelText("動画 URL"), url);
    await user.click(screen.getByRole("button", { name: "登録" }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith(url));
    expect(playlistSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("クリップボードの再生リストは確認の前で止まり、登録しない", async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(PLAYLIST_URL);
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    renderDialog();

    await user.click(screen.getByRole("button", { name: "クリップボードから登録" }));

    expect(await screen.findByRole("button", { name: "3 本を登録" })).toBeInTheDocument();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
