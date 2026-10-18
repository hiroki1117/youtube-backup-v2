import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { INIT_RAW_VIDEOS, TEST_API_BASE } from "@/test/handlers";
import { makeRawVideos } from "@/test/factories";
import {
  CATALOG_FETCH_MAX,
  CATALOG_FETCH_NUM,
  CATALOG_FETCH_STEP,
  useVideoCatalog,
} from "./useVideoCatalog";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useVideoCatalog（U2 / US2.1・US2.2・US2.4・US2.5）", () => {
  it("complete を取得し既定（desc）でソートした表示行を返す（US2.1/US2.3）", async () => {
    // 既定ハンドラ: complete = c1(08-01)/c2(08-03)/c3(08-02)
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.total).toBe(3);
    expect(result.current.items.map((v) => v.videoId)).toEqual(["c2", "c3", "c1"]);
    expect(result.current.uploadStatus).toBe("complete");
    expect(result.current.sortOrder).toBe("desc");
    expect(result.current.hasMore).toBe(false); // 3 件 < 取得件数 50（続きなし）
  });

  it("取得件数は CATALOG_FETCH_NUM（50）をクエリに付ける", async () => {
    let fetchNum: string | null = null;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        fetchNum = new URL(request.url).searchParams.get("fetch_num");
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(CATALOG_FETCH_NUM).toBe(50);
    expect(fetchNum).toBe(String(CATALOG_FETCH_NUM));
  });

  it("init フィルタへ切り替えると再取得し、取得件数を初期値へ戻す（US2.2）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        const status = new URL(request.url).searchParams.get("upload_status");
        return HttpResponse.json(status === "init" ? INIT_RAW_VIDEOS : makeRawVideos(25));
      }),
    );
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.total).toBe(25));

    act(() => result.current.setUploadStatus("init"));

    await waitFor(() => expect(result.current.uploadStatus).toBe("init"));
    await waitFor(() => expect(result.current.total).toBe(2));
    // init は i1(07-20)/i2(07-25) → desc で i2, i1
    expect(result.current.items.map((v) => v.videoId)).toEqual(["i2", "i1"]);
  });

  it("空一覧は success かつ total 0 を返す（FR8 empty）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json([])));
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.total).toBe(0);
    expect(result.current.items).toEqual([]);
  });

  it("transport 失敗は error を配布する（error-path 必須 / FR8）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.error()));
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.items).toEqual([]);
  });

  it("要求した件数を満たしたら hasMore。loadMore で fetch_num を 50 ずつ増やして取り直す", async () => {
    const requested: string[] = [];
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        const n = Number(new URL(request.url).searchParams.get("fetch_num"));
        requested.push(String(n));
        return HttpResponse.json(makeRawVideos(120).slice(0, n));
      }),
    );
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.total).toBe(50));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.total).toBe(100));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.total).toBe(120));
    expect(result.current.hasMore).toBe(false); // 150 件要求して 120 件 = 末尾まで取得
    expect(requested).toEqual(["50", "100", "150"]);
  });

  it("取得件数が上限（1000）に達したら hasMore を false にする", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        const n = Number(new URL(request.url).searchParams.get("fetch_num"));
        return HttpResponse.json(makeRawVideos(n));
      }),
    );
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.total).toBe(50));
    for (let expected = 100; expected <= CATALOG_FETCH_MAX; expected += CATALOG_FETCH_STEP) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.total).toBe(expected));
    }
    expect(result.current.hasMore).toBe(false);
  });

  it("ソート順トグルで並びが反転する（US2.3）", async () => {
    // makeRawVideos(25): backupdate 2026-08-01..08-25
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json(makeRawVideos(25))));
    const { result } = renderHook(() => useVideoCatalog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.total).toBe(25));
    // desc 既定: 先頭は最新 08-25（動画25）
    expect(result.current.items[0].title).toBe("動画25");

    act(() => result.current.toggleSortOrder());
    await waitFor(() => expect(result.current.sortOrder).toBe("asc"));
    expect(result.current.items[0].title).toBe("動画1"); // asc: 最古 08-01
  });
});
