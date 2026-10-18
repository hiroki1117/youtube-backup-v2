import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";
import { useVideoSearch } from "./useVideoSearch";

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useVideoSearch(), { wrapper: Wrapper });
}

describe("useVideoSearch（U3 / US3.1・FR3.1・C2）", () => {
  it("初期状態は idle（未検索・API 非実行）", () => {
    const { result } = setup();
    expect(result.current.state.kind).toBe("idle");
  });

  it("存在する video_id を検索すると ok(Video) を返す（happy path）", async () => {
    // 既定ハンドラ = complete 動画（video_id: "v1"）。
    const { result } = setup();

    act(() => result.current.search("v1"));

    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    const state = result.current.state;
    if (state.kind !== "ok") {
      throw new Error("expected ok state");
    }
    expect(state.video.videoId).toBe("v1");
    expect(state.video.uploadStatus).toBe("complete");
  });

  it("init 動画でも ok を返す（再生可否の判定は component 層の責務）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ video_id: "i1", upload_status: "init" })),
      ),
    );
    const { result } = setup();

    act(() => result.current.search("i1"));

    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    const state = result.current.state;
    if (state.kind !== "ok") {
      throw new Error("expected ok state");
    }
    expect(state.video.uploadStatus).toBe("init");
  });

  it("存在しない video_id は notFound を返す（error-path / FR3.1）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
    );
    const { result } = setup();

    act(() => result.current.search("missing"));

    await waitFor(() => expect(result.current.state.kind).toBe("notFound"));
  });

  it("空入力は API を叩かず invalidInput になる（US3.1）", async () => {
    const getSpy = vi.spyOn(apiClient, "getVideo");
    const { result } = setup();

    act(() => result.current.search("   "));

    expect(result.current.state.kind).toBe("invalidInput");
    // 少し待っても getVideo は呼ばれない。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it("transport 失敗は error を返す（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const { result } = setup();

    act(() => result.current.search("v1"));

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    const state = result.current.state;
    if (state.kind !== "error") {
      throw new Error("expected error state");
    }
    expect(state.message).toContain("通信");
  });

  it("別の video_id で再検索すると新しい結果へ切り替わる", async () => {
    const { result } = setup();

    act(() => result.current.search("v1"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));

    // 2 件目は別 id を返すハンドラへ差し替え。
    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ video_id: "v2", title: "別動画" })),
      ),
    );
    act(() => result.current.search("v2"));

    await waitFor(() => {
      const state = result.current.state;
      expect(state.kind).toBe("ok");
      if (state.kind !== "ok") {
        throw new Error("expected ok state");
      }
      expect(state.video.videoId).toBe("v2");
    });
    const state = result.current.state;
    if (state.kind !== "ok") {
      throw new Error("expected ok state");
    }
    expect(state.video.title).toBe("別動画");
  });
});
