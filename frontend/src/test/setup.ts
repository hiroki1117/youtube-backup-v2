import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { clearNotifications } from "@/lib/notify";
import { server } from "./server";

// jsdom は matchMedia 未実装のため既定モックを提供（既定 matches:false）。
// prefers-color-scheme を検証するテストは window.matchMedia を上書きする。
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearNotifications();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  document.documentElement.removeAttribute("data-theme");
});

afterAll(() => {
  server.close();
});

// Cognito へ接続せず、API 呼び出しには固定のダミートークンを使う（実トークンではない）。
// 認証切れ（トークンなし）の挙動は client.test.ts でトークン取得関数を注入して検証する。
vi.mock("@/api/token", () => ({
  getIdToken: () => Promise.resolve("test-token"),
}));
