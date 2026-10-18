import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { subscribe, type Notification } from "@/lib/notify";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse } from "@/test/handlers";
import { makeVideo } from "@/test/factories";
import { useVideoDeletion } from "./useVideoDeletion";

/** 通知の発行を購読して捕捉する（notify は setup.ts の afterEach で clear 済み）。 */
function captureNotifications() {
  let items: Notification[] = [];
  const unsub = subscribe((next) => {
    items = next;
  });
  return { get: () => items, unsub };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = renderHook(() => useVideoDeletion(), { wrapper: Wrapper });
  return { ...view, invalidateSpy };
}

describe("useVideoDeletion（U5 / US5.1・FR5.1・C2・C4）", () => {
  it("requestDelete で対象を pending にする（即削除しない / FR5.1）", () => {
    const deleteSpy = vi.spyOn(apiClient, "deleteVideo");
    const { result } = setup();
    const target = makeVideo({ videoId: "c1", title: "削除対象動画" });

    act(() => result.current.requestDelete(target));

    expect(result.current.pendingVideo).toEqual(target);
    // 確認前に API を叩かない。
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it("cancelDelete で pending をクリアする（API は呼ばない）", () => {
    const deleteSpy = vi.spyOn(apiClient, "deleteVideo");
    const { result } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "c1" })));
    act(() => result.current.cancelDelete());

    expect(result.current.pendingVideo).toBeNull();
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it("確定成功で success 通知を出し ['videos'] を invalidate し pending をクリアする（US5.1）", async () => {
    // 既定 DELETE ハンドラ = 削除成功
    const cap = captureNotifications();
    const { result, invalidateSpy } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "c1", title: "削除対象動画" })));
    act(() => result.current.confirmDelete());

    await waitFor(() => expect(cap.get().some((n) => n.kind === "success")).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["videos"] });
    await waitFor(() => expect(result.current.pendingVideo).toBeNull());
    cap.unsub();
  });

  it("バックアップ中拒否（rejected/backupInProgress）は error 通知を出し invalidate しない＝一覧不変（error-path / R-02）", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:videoId`, () =>
        errorResponse(409, "backup_object_needs_reconciliation"),
      ),
    );
    const cap = captureNotifications();
    const { result, invalidateSpy } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "i1", uploadStatus: "init" })));
    act(() => result.current.confirmDelete());

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    const errorNote = cap.get().find((n) => n.kind === "error");
    expect(errorNote?.message).toContain("バックアップ中");
    // 拒否時は一覧を無効化しない（一覧不変）。
    expect(invalidateSpy).not.toHaveBeenCalled();
    // 処理後は pending をクリアしダイアログを閉じる。
    await waitFor(() => expect(result.current.pendingVideo).toBeNull());
    cap.unsub();
  });

  it("transport 失敗は error 通知を出し invalidate しない（error-path / FR8）", async () => {
    server.use(http.delete(`${TEST_API_BASE}/videos/:videoId`, () => HttpResponse.error()));
    const cap = captureNotifications();
    const { result, invalidateSpy } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "c1" })));
    act(() => result.current.confirmDelete());

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
    cap.unsub();
  });

  it("deleteVideo が想定外に throw しても silent failure にせず error 通知を出す（FR8）", async () => {
    const deleteSpy = vi
      .spyOn(apiClient, "deleteVideo")
      .mockRejectedValueOnce(new Error("unexpected"));
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "c1" })));
    act(() => result.current.confirmDelete());

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    await waitFor(() => expect(result.current.pendingVideo).toBeNull());
    deleteSpy.mockRestore();
  });

  it("確定中の再確定は無視され deleteVideo は 1 回だけ呼ばれる（二重確定抑止）", async () => {
    const deleteSpy = vi.spyOn(apiClient, "deleteVideo");
    const { result } = setup();

    act(() => result.current.requestDelete(makeVideo({ videoId: "c1" })));
    act(() => {
      result.current.confirmDelete();
      result.current.confirmDelete();
    });

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    deleteSpy.mockRestore();
  });

  it("pending 不在で confirmDelete を呼んでも API を呼ばない（防御ガード）", () => {
    const deleteSpy = vi.spyOn(apiClient, "deleteVideo");
    const { result } = setup();

    act(() => result.current.confirmDelete());

    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
  });
});
