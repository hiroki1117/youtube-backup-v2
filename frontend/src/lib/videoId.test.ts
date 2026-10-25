import { describe, expect, it } from "vitest";
import { extractVideoId } from "./videoId";

describe("extractVideoId（U3 / US3.1・FR3.1）", () => {
  it("生の video_id はそのまま返す", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("前後の空白を trim して video_id を返す", () => {
    expect(extractVideoId("  dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });

  it("youtube.com/watch?v= から video_id を抽出する", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("クエリ付き watch URL（&t= 等）でも v パラメータを抽出する", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=abc")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("youtu.be 短縮 URL からパス先頭セグメントを抽出する", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("クエリ付き youtu.be 短縮 URL でも video_id を抽出する", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  });

  it("youtube.com/shorts/ID 形式からも抽出する", () => {
    expect(extractVideoId("https://www.youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
  });

  it("空文字・空白のみは null を返す（API を叩かせない）", () => {
    expect(extractVideoId("")).toBeNull();
    expect(extractVideoId("   ")).toBeNull();
  });

  it("tiktok.com/@user/video/ID 形式から数字の video_id を抽出する", () => {
    expect(
      extractVideoId("https://www.tiktok.com/@example.user/video/7684271790369099040?_r=1"),
    ).toBe("7684271790369099040");
  });

  it("TikTok の短縮リンクは video_id を特定できず null を返す", () => {
    expect(extractVideoId("https://vt.tiktok.com/ZSgQrPP3P/")).toBeNull();
  });

  it("video_id を特定できない YouTube URL は null を返す", () => {
    expect(extractVideoId("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });
});
