import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { subscribe, type Notification } from "@/lib/notify";
import { server } from "@/test/server";
import { TEST_API_BASE, TEST_PRESIGNED_URL, errorResponse, makePlaybackUrl } from "@/test/handlers";
import { makeVideo } from "@/test/factories";
import { useVideoDownload } from "./useVideoDownload";

/**
 * ダウンロードフックのユニットテスト（U6 / US6.1・FR6・C2・C4）。
 * DL 起動（download.ts）はモックし、署名 URL 取得と通知（C4）・A3 ガードを検証する。
 * error-path（署名失敗→notify(error)）を必須で含む。
 */

vi.mock("@/lib/download", () => ({
  downloadPresignedUrl: vi.fn(() => true),
}));
import { downloadPresignedUrl } from "@/lib/download";

const downloadMock = vi.mocked(downloadPresignedUrl);

/** 通知の発行を購読して捕捉する（notify は setup.ts の afterEach で clear 済み）。 */
function captureNotifications() {
  let items: Notification[] = [];
  const unsub = subscribe((next) => {
    items = next;
  });
  return { get: () => items, unsub };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useVideoDownload(), { wrapper: Wrapper });
}

describe("useVideoDownload（U6 / US6.1・FR6・C2・C4）", () => {
  beforeEach(() => {
    downloadMock.mockClear();
    downloadMock.mockReturnValue(true);
  });

  it("complete 動画の DL は署名 URL を取得し download を起動する（happy path）", async () => {
    // 既定 GET /presigned-s3url = 成功。
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(downloadMock).toHaveBeenCalledWith(TEST_PRESIGNED_URL, expect.any(String));
  });

  it("取得中は isPreparing=true、完了後は false になる", async () => {
    // 署名 URL 応答を遅延させ、取得中フラグを観測可能にする。
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, async () => {
        await delay(50);
        return HttpResponse.json(makePlaybackUrl());
      }),
    );
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));
    await waitFor(() => expect(result.current.isPreparing).toBe(true));
    await waitFor(() => expect(result.current.isPreparing).toBe(false));
  });

  it("署名 URL の transport 失敗は error 通知を出し download を起動しない（error-path / FR8）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () => HttpResponse.error()),
    );
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    expect(downloadMock).not.toHaveBeenCalled();
    cap.unsub();
  });

  it("署名 URL が notFound のとき error 通知を出す（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () =>
        errorResponse(404, "video_not_found"),
      ),
    );
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    const note = cap.get().find((n) => n.kind === "error");
    expect(note?.message).toContain("動画が見つかりません");
    expect(downloadMock).not.toHaveBeenCalled();
    cap.unsub();
  });

  it("init 動画の DL は A3 ガードで何もしない（署名 URL を取得しない）", async () => {
    const presignedSpy = vi.spyOn(apiClient, "getPresignedUrl");
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "i1", uploadStatus: "init" })));

    expect(presignedSpy).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
    presignedSpy.mockRestore();
  });

  it("download.ts が非 https 等で false を返したら error 通知を出す（NFR4 / error-path）", async () => {
    downloadMock.mockReturnValueOnce(false);
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    const note = cap.get().find((n) => n.kind === "error");
    expect(note?.message).toContain("無効");
    cap.unsub();
  });

  it("getPresignedUrl が想定外に throw しても silent failure にせず error 通知を出す（FR8）", async () => {
    const presignedSpy = vi
      .spyOn(apiClient, "getPresignedUrl")
      .mockRejectedValueOnce(new Error("unexpected"));
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" })));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    expect(downloadMock).not.toHaveBeenCalled();
    presignedSpy.mockRestore();
  });

  it("取得中の再呼び出しは無視され getPresignedUrl は 1 回だけ呼ばれる（二重起動抑止）", async () => {
    const presignedSpy = vi.spyOn(apiClient, "getPresignedUrl");
    const { result } = setup();

    act(() => {
      result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" }));
      result.current.download(makeVideo({ videoId: "c1", uploadStatus: "complete" }));
    });

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(presignedSpy).toHaveBeenCalledTimes(1);
    presignedSpy.mockRestore();
  });
});
