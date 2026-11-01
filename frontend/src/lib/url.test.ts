import { describe, expect, it } from "vitest";
import { parseHttpsUrl, isYoutubePlaylistUrl, validateVideoUrl } from "./url";

describe("validateVideoUrl（US4.1 / NFR4 クライアント URL 検証）", () => {
  it("有効な https URL を ok + 正規化 URL で返す（happy path）", () => {
    const result = validateVideoUrl("https://www.youtube.com/watch?v=abc123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://www.youtube.com/watch?v=abc123");
    }
  });

  it("前後の空白を trim して検証する（有効判定）", () => {
    const result = validateVideoUrl("  https://youtu.be/abc123  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://youtu.be/abc123");
    }
  });

  it("空文字は ok:false（未入力理由）を返す", () => {
    const result = validateVideoUrl("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("入力");
    }
  });

  it("空白のみは ok:false（未入力理由）を返す", () => {
    const result = validateVideoUrl("   ");
    expect(result.ok).toBe(false);
  });

  it("http（非 https）スキームは ok:false（https 要求理由）を返す（NFR4）", () => {
    const result = validateVideoUrl("http://example.com/video");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("https");
    }
  });

  it("javascript: スキームは ok:false を返す（スキーム injection 対策）", () => {
    const result = validateVideoUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("URL として解釈できない文字列は ok:false（形式不正理由）を返す", () => {
    const result = validateVideoUrl("not a url");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("形式");
    }
  });
});

describe("parseHttpsUrl（https 検証の共通ヘルパ）", () => {
  it("https URL は正規化した URL を返す", () => {
    const parsed = parseHttpsUrl("https://example.com/file.mp4");
    expect(parsed).not.toBeNull();
    expect(parsed?.href).toBe("https://example.com/file.mp4");
  });

  it("非 https・空・不正構文はすべて null を返す", () => {
    expect(parseHttpsUrl("http://example.com")).toBeNull();
    expect(parseHttpsUrl("")).toBeNull();
    expect(parseHttpsUrl("   ")).toBeNull();
    expect(parseHttpsUrl("not a url")).toBeNull();
  });
});

describe("isYoutubePlaylistUrl（登録ダイアログの分岐）", () => {
  it.each([
    "https://www.youtube.com/playlist?list=PLabc",
    "https://youtube.com/playlist?list=PLabc",
    "https://m.youtube.com/playlist?list=PLabc",
    "https://music.youtube.com/playlist?list=OLAK5uy_abc",
    // 読めない種類でも、再生リストのページなら backend に理由を返させる。
    "https://www.youtube.com/playlist?list=WL",
  ])("%s は再生リスト", (url) => {
    expect(isYoutubePlaylistUrl(url)).toBe(true);
  });

  it.each([
    "https://www.youtube.com/watch?v=abcdefghijk",
    // 再生中の動画に再生リストが付いた URL は、動画 1 本として登録する。
    "https://www.youtube.com/watch?v=abcdefghijk&list=PLabc&index=2",
    "https://youtu.be/abcdefghijk?list=PLabc",
    "https://www.youtube.com/playlist",
    "https://example.com/playlist?list=PLabc",
  ])("%s は再生リストではない", (url) => {
    expect(isYoutubePlaylistUrl(url)).toBe(false);
  });
});
