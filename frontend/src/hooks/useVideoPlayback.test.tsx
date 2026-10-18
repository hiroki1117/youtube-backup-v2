import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { server } from "@/test/server";
import { TEST_API_BASE, TEST_PRESIGNED_URL, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";
import { useVideoPlayback } from "./useVideoPlayback";

/**
 * 再生フックのユニットテスト（U6 / US6.2・FR7・C2）。MSW で ApiClient 実コードを通す。
 * complete→詳細+署名 URL / init→署名取得しない / 未存在 / 署名失敗（error-path）/ refetch を検証する。
 */

function setup(videoId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useVideoPlayback(videoId), { wrapper: Wrapper });
}

describe("useVideoPlayback（U6 / US6.2・FR7・C2）", () => {
  it("complete 動画は詳細を取得し署名 URL を ready にする（happy path）", async () => {
    // 既定ハンドラ: GET /videos/:id → complete、GET /presigned-s3url → 成功。
    const { result } = setup("v1");

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    const state = result.current.state;
    if (state.kind !== "ready") {
      throw new Error("expected ready");
    }
    expect(state.video.uploadStatus).toBe("complete");
    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === "ready" && s.source.status === "ready").toBe(true);
    });
    const ready = result.current.state;
    if (ready.kind === "ready" && ready.source.status === "ready") {
      expect(ready.source.url).toBe(TEST_PRESIGNED_URL);
    }
  });

  it("init 動画は notPlayable にし署名 URL を取得しない（A3）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ upload_status: "init" })),
      ),
    );
    const presignedSpy = vi.spyOn(apiClient, "getPresignedUrl");
    const { result } = setup("i1");

    await waitFor(() => expect(result.current.state.kind).toBe("notPlayable"));
    // A3: init では署名 URL を取得しない。
    expect(presignedSpy).not.toHaveBeenCalled();
    presignedSpy.mockRestore();
  });

  it("未存在の動画は notFound にし署名 URL を取得しない", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    const presignedSpy = vi.spyOn(apiClient, "getPresignedUrl");
    const { result } = setup("missing");

    await waitFor(() => expect(result.current.state.kind).toBe("notFound"));
    expect(presignedSpy).not.toHaveBeenCalled();
    presignedSpy.mockRestore();
  });

  it("署名 URL の transport 失敗は source を error にする（OQ2 / error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () => HttpResponse.error()),
    );
    const { result } = setup("v1");

    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === "ready" && s.source.status === "error").toBe(true);
    });
  });

  it("署名 URL が notFound のとき source を error にする（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId/playback_url`, () =>
        errorResponse(404, "video_not_found"),
      ),
    );
    const { result } = setup("v1");

    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === "ready" && s.source.status === "error").toBe(true);
    });
  });

  it("詳細取得の transport 失敗は state を error にする（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const { result } = setup("v1");

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    const state = result.current.state;
    if (state.kind === "error") {
      expect(state.message).toContain("通信");
    }
  });

  it("refetch で詳細と署名 URL を再取得する", async () => {
    const getVideoSpy = vi.spyOn(apiClient, "getVideo");
    const getPresignedSpy = vi.spyOn(apiClient, "getPresignedUrl");
    const { result } = setup("v1");

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    const getVideoCalls = getVideoSpy.mock.calls.length;
    const getPresignedCalls = getPresignedSpy.mock.calls.length;

    result.current.refetch();

    await waitFor(() => expect(getVideoSpy.mock.calls.length).toBeGreaterThan(getVideoCalls));
    await waitFor(() =>
      expect(getPresignedSpy.mock.calls.length).toBeGreaterThan(getPresignedCalls),
    );
    getVideoSpy.mockRestore();
    getPresignedSpy.mockRestore();
  });
});
