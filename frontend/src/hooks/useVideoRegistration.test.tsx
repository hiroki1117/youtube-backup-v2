import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { subscribe, type Notification } from "@/lib/notify";
import { server } from "@/test/server";
import { TEST_API_BASE, errorResponse, makeRegistration } from "@/test/handlers";
import { useVideoRegistration } from "./useVideoRegistration";

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
  const view = renderHook(() => useVideoRegistration(), { wrapper: Wrapper });
  return { ...view, invalidateSpy };
}

describe("useVideoRegistration（U4 / US4.1・FR4.1・FR4.2・C2・C4）", () => {
  it("新規登録成功で success 通知を出し ['videos'] を invalidate する（FR4.1/FR4.2）", async () => {
    // 既定 POST ハンドラ = 新規登録成功
    const cap = captureNotifications();
    const { result, invalidateSpy } = setup();

    act(() => result.current.submit("https://youtu.be/abc"));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "success")).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["videos"] });
    cap.unsub();
  });

  it("既登録（already_backup=true）は info 通知を出す（C2）", async () => {
    server.use(
      http.post(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json(makeRegistration({ already_registered: true })),
      ),
    );
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.submit("https://youtu.be/abc"));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "info")).toBe(true));
    expect(cap.get().some((n) => n.kind === "success")).toBe(false);
    cap.unsub();
  });

  it("URL 異常（invalidInput）は error 通知を出す（error-path / C2・C4）", async () => {
    server.use(http.post(`${TEST_API_BASE}/videos`, () => errorResponse(422, "invalid_url")));
    const cap = captureNotifications();
    const { result, invalidateSpy } = setup();

    act(() => result.current.submit("https://youtu.be/bad"));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    const errorNote = cap.get().find((n) => n.kind === "error");
    expect(errorNote?.message).toContain("URL");
    // 失敗時は一覧を無効化しない。
    expect(invalidateSpy).not.toHaveBeenCalled();
    cap.unsub();
  });

  it("transport 失敗は error 通知を出す（error-path / FR8）", async () => {
    server.use(http.post(`${TEST_API_BASE}/videos`, () => HttpResponse.error()));
    const cap = captureNotifications();
    const { result } = setup();

    act(() => result.current.submit("https://youtu.be/abc"));

    await waitFor(() => expect(cap.get().some((n) => n.kind === "error")).toBe(true));
    cap.unsub();
  });

  it("送信中の再呼び出しは無視され submitVideo は 1 回だけ呼ばれる（二重送信抑止 / US4.1）", async () => {
    const submitSpy = vi.spyOn(apiClient, "submitVideo");
    const { result } = setup();

    act(() => {
      result.current.submit("https://youtu.be/abc");
      result.current.submit("https://youtu.be/abc");
    });

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    // 完了後は再度送信できる（フラグが解放される）。
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    act(() => result.current.submit("https://youtu.be/def"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(2));
    submitSpy.mockRestore();
  });
});
