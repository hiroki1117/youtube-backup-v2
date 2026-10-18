import { describe, expect, it } from "vitest";
import { makeVideos } from "@/test/factories";
import { sortVideos } from "./catalog";

describe("sortVideos（US2.3 / FR2.3）", () => {
  it("desc は backupDate 降順に並べる", () => {
    const videos = makeVideos([
      { videoId: "a", backupDate: "2026-08-01" },
      { videoId: "b", backupDate: "2026-08-03" },
      { videoId: "c", backupDate: "2026-08-02" },
    ]);
    const sorted = sortVideos(videos, "desc");
    expect(sorted.map((v) => v.videoId)).toEqual(["b", "c", "a"]);
  });

  it("asc は backupDate 昇順に並べる", () => {
    const videos = makeVideos([
      { videoId: "a", backupDate: "2026-08-01" },
      { videoId: "b", backupDate: "2026-08-03" },
      { videoId: "c", backupDate: "2026-08-02" },
    ]);
    const sorted = sortVideos(videos, "asc");
    expect(sorted.map((v) => v.videoId)).toEqual(["a", "c", "b"]);
  });

  it("同一 backupDate は入力順を保持する（安定ソート・降順）", () => {
    const videos = makeVideos([
      { videoId: "x1", backupDate: "2026-08-05" },
      { videoId: "x2", backupDate: "2026-08-05" },
      { videoId: "x3", backupDate: "2026-08-05" },
    ]);
    const sorted = sortVideos(videos, "desc");
    expect(sorted.map((v) => v.videoId)).toEqual(["x1", "x2", "x3"]);
  });

  it("入力配列を破壊しない（新しい配列を返す）", () => {
    const videos = makeVideos([
      { videoId: "a", backupDate: "2026-08-01" },
      { videoId: "b", backupDate: "2026-08-02" },
    ]);
    const original = videos.map((v) => v.videoId);
    sortVideos(videos, "desc");
    expect(videos.map((v) => v.videoId)).toEqual(original);
  });

  it("空配列はそのまま空を返す", () => {
    expect(sortVideos([], "asc")).toEqual([]);
  });
});
