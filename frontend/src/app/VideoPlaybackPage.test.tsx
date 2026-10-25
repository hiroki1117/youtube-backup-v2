import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/Toaster";
import { VideoPlaybackPage } from "@/app/VideoPlaybackPage";
import { server } from "@/test/server";
import { TEST_API_BASE, TEST_PRESIGNED_URL, errorResponse } from "@/test/handlers";
import {
  makeRawCommentBackup,
  makeRawVideo,
  makeRawYoutubeComment,
  makeRawYoutubeCommentPage,
} from "@/test/factories";

/**
 * 再生ページのユニットテスト（U6 / US6.2・FR7・OQ2・A3・C4）。
 * RTL + memory router + MSW。complete→<video>+DL / 署名失敗→error(+retry) / init→再生不可 /
 * notFound / 戻るリンク / フォーカス / role・aria を検証する（実再生は jsdom 非対応のため src のみ検証）。
 */

function renderPage(id = "v1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/videos/${id}`]}>
        <Routes>
          <Route path="/videos/:videoId" element={<VideoPlaybackPage />} />
          <Route path="/videos" element={<div>一覧ページ</div>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("VideoPlaybackPage（U6 / US6.2・FR7・A3・C4）", () => {
  it("complete 動画は <video src=署名URL> と DL ボタンを表示する（happy path）", async () => {
    // 既定ハンドラ: GET /videos/:id → complete、GET /presigned-s3url → 成功。
    renderPage();

    const player = await screen.findByTestId("video-player");
    expect(player.tagName).toBe("VIDEO");
    expect(player).toHaveAttribute("src", TEST_PRESIGNED_URL);
    expect(player).toHaveAttribute("controls");
    expect(screen.getByTestId("playback-download-button")).toBeInTheDocument();
  });

  it("署名 URL 取得失敗は error フォールバック + 再試行を表示する（OQ2 / error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () => HttpResponse.error()),
    );
    renderPage();

    // error フォールバック（C4 role=alert）+ 再試行ボタン。
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    // 再生できないので <video> は出さない。
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
  });

  it("init 動画は再生不可メッセージを表示し再生/DL を出さない（A3）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ upload_status: "init" })),
      ),
    );
    renderPage("i1");

    expect(await screen.findByText(/まだ再生・ダウンロードできません/)).toBeInTheDocument();
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
    expect(screen.queryByTestId("playback-download-button")).not.toBeInTheDocument();
  });

  it("未存在の動画は「見つかりませんでした」を表示する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    renderPage("missing");

    expect(await screen.findByText(/見つかりませんでした/)).toBeInTheDocument();
    expect(screen.queryByTestId("video-player")).not.toBeInTheDocument();
  });

  it("一覧へ戻るリンクで一覧ページへ遷移する", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("video-player");

    await user.click(screen.getByTestId("playback-back-link"));

    expect(await screen.findByText("一覧ページ")).toBeInTheDocument();
  });

  it("表示時に見出しへフォーカスする（アクセシビリティ）", async () => {
    renderPage();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("playback-heading")),
    );
  });

  it("section に aria-label、<video> に aria-label を付与する（role/aria）", async () => {
    renderPage();

    const player = await screen.findByTestId("video-player");
    expect(player).toHaveAttribute("aria-label", expect.stringContaining("動画プレイヤー"));
    expect(screen.getByRole("region", { name: "動画再生" })).toBeInTheDocument();
  });
});

describe("VideoPlaybackPage の削除", () => {
  it("complete 動画は確認のうえ削除し、一覧へ戻る", async () => {
    let deleted = 0;
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:videoId`, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("video-player");

    await user.click(screen.getByTestId("playback-delete-button"));
    // 確認するまでは削除しない。
    expect(screen.getByTestId("delete-confirm-dialog")).toBeInTheDocument();
    expect(deleted).toBe(0);
    await user.click(screen.getByTestId("delete-confirm-button"));

    expect(await screen.findByText("一覧ページ")).toBeInTheDocument();
    expect(deleted).toBe(1);
  });

  it("init 動画は「取り消し」でバックアップを取り消し、一覧へ戻る", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ upload_status: "init" })),
      ),
    );
    const user = userEvent.setup();
    renderPage("i1");
    await screen.findByText(/まだ再生・ダウンロードできません/);

    const button = screen.getByTestId("playback-delete-button");
    expect(button).toHaveTextContent("取り消し");
    await user.click(button);
    await user.click(screen.getByTestId("delete-confirm-button"));

    expect(await screen.findByText("一覧ページ")).toBeInTheDocument();
  });

  it("削除に失敗したらページに留まり、エラーを通知する（error-path）", async () => {
    server.use(http.delete(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("video-player");

    await user.click(screen.getByTestId("playback-delete-button"));
    await user.click(screen.getByTestId("delete-confirm-button"));

    expect(await screen.findByText(/通信に失敗しました/)).toBeInTheDocument();
    expect(screen.queryByText("一覧ページ")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-player")).toBeInTheDocument();
  });
});

describe("VideoPlaybackPage のコメントのバックアップ", () => {
  it("YouTube の complete 動画はボタンでコメントの取得を開始し、取得中にする", async () => {
    let posted = 0;
    server.use(
      http.post(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () => {
        posted += 1;
        return HttpResponse.json(makeRawCommentBackup({ state: "running" }), { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "コメントをバックアップ" }));

    expect(await screen.findByText("コメントのバックアップを開始しました")).toBeInTheDocument();
    expect(screen.getByTestId("comment-backup-state")).toHaveTextContent("取得中");
    expect(screen.getByRole("button", { name: "取得中..." })).toBeDisabled();
    expect(posted).toBe(1);
  });

  it("取得済みの動画は「コメントを最新化」を出す", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () =>
        HttpResponse.json(
          makeRawCommentBackup({ state: "complete", comment_count: 3, completed_at: 1792713600 }),
        ),
      ),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "コメントを最新化" })).toBeEnabled();
    expect(screen.getByTestId("comment-backup-last")).toHaveTextContent("3 件");
  });

  it("取得中で何もしなかった応答（200）は、その旨を通知する", async () => {
    server.use(
      http.post(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () =>
        HttpResponse.json(makeRawCommentBackup({ state: "running" })),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "コメントをバックアップ" }));

    expect(await screen.findByText("コメントはすでに取得中です")).toBeInTheDocument();
  });

  it("開始の拒否は通知し、状態は変えない（error-path）", async () => {
    server.use(
      http.post(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () =>
        errorResponse(409, "backup_not_complete"),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "コメントをバックアップ" }));

    expect(
      await screen.findByText("バックアップが完了していないため実行できません。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("comment-backup-state")).toHaveTextContent("未取得");
  });

  it("状態の照会に失敗したら、欄の中で再試行できる（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () => HttpResponse.error()),
    );
    renderPage();

    const panel = await screen.findByTestId("comment-backup-panel");
    expect(await within(panel).findByRole("alert")).toHaveTextContent("通信に失敗しました");
    server.resetHandlers();
    await userEvent.setup().click(within(panel).getByRole("button", { name: "再試行" }));
    expect(await within(panel).findByTestId("comment-backup-state")).toHaveTextContent("未取得");
  });

  it("YouTube 以外の動画にはコメントの欄を出さない", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ platform: "twitter" })),
      ),
    );
    renderPage();

    await screen.findByTestId("video-player");
    expect(screen.queryByTestId("comment-backup-panel")).not.toBeInTheDocument();
  });

  it("処理中（init）の動画にはコメントの欄を出さない", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ upload_status: "init" })),
      ),
    );
    renderPage("i1");

    await screen.findByText(/まだ再生・ダウンロードできません/);
    expect(screen.queryByTestId("comment-backup-panel")).not.toBeInTheDocument();
  });
});

describe("VideoPlaybackPage のバックアップしたコメントの一覧", () => {
  const completed = () =>
    http.get(`${TEST_API_BASE}/videos/:videoId/comments/backup`, () =>
      HttpResponse.json(
        makeRawCommentBackup({ state: "complete", comment_count: 2, completed_at: 1792713600 }),
      ),
    );

  it("取得が完了していれば、コメントと件数を表示する", async () => {
    server.use(
      completed(),
      http.get(`${TEST_API_BASE}/videos/:videoId/comments`, () =>
        HttpResponse.json(
          makeRawYoutubeCommentPage([
            {
              ...makeRawYoutubeComment({ text: "最初のコメント" }),
              replies: [makeRawYoutubeComment({ comment_id: "r1", parent: "Ugx1" })],
            },
          ]),
        ),
      ),
    );
    renderPage();

    expect(await screen.findByText("最初のコメント")).toBeInTheDocument();
    expect(screen.getByTestId("youtube-comment-total")).toHaveTextContent("2 件（スレッド 1 件）");
    expect(screen.getByText("返信 1 件")).toBeInTheDocument();
  });

  it("「もっと見る」で次のページを継ぎ足す", async () => {
    server.use(
      completed(),
      http.get(`${TEST_API_BASE}/videos/:videoId/comments`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get("offset");
        const page =
          offset === "0"
            ? makeRawYoutubeCommentPage(
                [
                  {
                    ...makeRawYoutubeComment({ comment_id: "a", text: "1 ページ目" }),
                    replies: [],
                  },
                ],
                20,
              )
            : makeRawYoutubeCommentPage([
                { ...makeRawYoutubeComment({ comment_id: "b", text: "2 ページ目" }), replies: [] },
              ]);
        return HttpResponse.json(page);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "もっと見る" }));

    expect(await screen.findByText("2 ページ目")).toBeInTheDocument();
    expect(screen.getByText("1 ページ目")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もっと見る" })).not.toBeInTheDocument();
  });

  it("まだ一度も取得が完了していなければ、一覧を出さない", async () => {
    renderPage();

    await screen.findByRole("button", { name: "コメントをバックアップ" });
    expect(screen.queryByTestId("youtube-comment-list")).not.toBeInTheDocument();
  });

  it("一覧の読み込みに失敗したら、一覧の中で再試行できる（error-path）", async () => {
    server.use(
      completed(),
      http.get(`${TEST_API_BASE}/videos/:videoId/comments`, () => HttpResponse.error()),
    );
    renderPage();

    const list = await screen.findByTestId("youtube-comment-list");
    expect(await within(list).findByRole("alert")).toHaveTextContent(
      "コメントを読み込めませんでした",
    );
    expect(screen.getByRole("button", { name: "コメントを最新化" })).toBeEnabled();
  });
});
