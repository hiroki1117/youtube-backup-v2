import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import type { SearchFilters } from "@/lib/search";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";
import { useVideoSearch } from "./useVideoSearch";

function filters(text: string, from = "", to = ""): SearchFilters {
  return { text, from, to };
}

function setup(initial: SearchFilters) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return renderHook((props: SearchFilters) => useVideoSearch(props), {
    wrapper: Wrapper,
    initialProps: initial,
  });
}

function videoNotFound() {
  server.use(
    http.get(`${TEST_API_BASE}/videos/:videoId`, () => errorResponse(404, "video_not_found")),
  );
}

describe("useVideoSearch（U3 / US3.1・FR3.1・C2）", () => {
  it("条件がなければ idle で API を呼ばない", async () => {
    const getSpy = vi.spyOn(apiClient, "getVideo");
    const searchSpy = vi.spyOn(apiClient, "searchVideos");
    const { result } = setup(filters("   "));

    expect(result.current.state.kind).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
    searchSpy.mockRestore();
  });

  it("動画 ID の完全一致を DynamoDB から先に返す（検索 API を呼ばない）", async () => {
    const searchSpy = vi.spyOn(apiClient, "searchVideos");
    const { result } = setup(filters("v1"));

    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    const state = result.current.state;
    if (state.kind !== "ok") {
      throw new Error("expected ok state");
    }
    expect(state.videos[0].videoId).toBe("v1");
    expect(state.hasMore).toBe(false);
    expect(searchSpy).not.toHaveBeenCalled();
    searchSpy.mockRestore();
  });

  it("動画 ID が未存在なら部分一致の検索へ進み、上限まで取得する", async () => {
    videoNotFound();
    let limit: string | null = null;
    server.use(
      http.get(`${TEST_API_BASE}/search/videos`, ({ request }) => {
        limit = new URL(request.url).searchParams.get("limit");
        return HttpResponse.json({
          items: [makeRawVideo({ video_id: "v9", title: "猫" })],
          has_more: true,
        });
      }),
    );
    const { result } = setup(filters("cat"));

    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    const state = result.current.state;
    if (state.kind !== "ok") {
      throw new Error("expected ok state");
    }
    expect(state.videos[0].videoId).toBe("v9");
    expect(state.hasMore).toBe(true);
    expect(limit).toBe("100");
  });

  it("どこにもなければ notFound を返す", async () => {
    videoNotFound();
    const { result } = setup(filters("missing"));

    await waitFor(() => expect(result.current.state.kind).toBe("notFound"));
  });

  it("URL の動画が未存在なら検索へ進まず notFound を返す", async () => {
    const searchSpy = vi.spyOn(apiClient, "searchVideos");
    videoNotFound();
    const { result } = setup(filters("https://youtu.be/missing"));

    await waitFor(() => expect(result.current.state.kind).toBe("notFound"));
    expect(searchSpy).not.toHaveBeenCalled();
    searchSpy.mockRestore();
  });

  it("ID を特定できない URL は API を叩かず invalidInput になる", () => {
    const getSpy = vi.spyOn(apiClient, "getVideo");
    const { result } = setup(filters("https://example.com/watch"));

    expect(result.current.state.kind).toBe("invalidInput");
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it.each([
    ["空白を含む語", filters("猫 まとめ")],
    ["コロンを含むタイトル", filters("Re:ゼロ")],
    ["日付の指定", filters("v1", "2026-08-01")],
    ["日付だけの検索", filters("", "2026-08-01", "2026-08-31")],
  ])("%s は getVideo を呼ばず検索する", async (_name, input) => {
    const getSpy = vi.spyOn(apiClient, "getVideo");
    const { result } = setup(input);

    await waitFor(() => expect(result.current.state.kind).toBe("notFound"));
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it("transport 失敗は error を返す（error-path / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const { result } = setup(filters("v1"));

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    const state = result.current.state;
    if (state.kind !== "error") {
      throw new Error("expected error state");
    }
    expect(state.message).toContain("通信");
  });

  it("条件を変えると新しい結果へ切り替わる", async () => {
    const { result, rerender } = setup(filters("v1"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));

    server.use(
      http.get(`${TEST_API_BASE}/videos/:videoId`, () =>
        HttpResponse.json(makeRawVideo({ video_id: "v2", title: "別動画" })),
      ),
    );
    rerender(filters("v2"));

    await waitFor(() => {
      const state = result.current.state;
      expect(state.kind === "ok" && state.videos[0].videoId).toBe("v2");
    });
  });
});
