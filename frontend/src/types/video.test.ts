import { describe, expect, it } from "vitest";
import { videoSchema } from "./video";
import { makeRawVideo } from "@/test/factories";

const parse = (raw: unknown) => videoSchema.safeParse(raw).data ?? null;

describe("parseVideo（VideoModel / contract C3）", () => {
  it("有効な生 Video をキャメルケースの Video に変換する", () => {
    const result = parse(makeRawVideo());
    expect(result).not.toBeNull();
    expect(result).toEqual({
      videoId: "v1",
      videoUrl: "https://www.youtube.com/watch?v=abc123",
      platform: "youtube",
      title: "サンプル動画",
      backupDate: "2026-08-01",
      s3FullPath: "s3://example-bucket/v1.mp4",
      uploadStatus: "complete",
      requestTimestamp: "1690000000",
    });
  });

  it("必須フィールドが欠落した値は null を返す", () => {
    const raw = makeRawVideo();
    const partial: Record<string, unknown> = { ...raw };
    delete partial.title;
    expect(parse(partial)).toBeNull();
  });

  it.each([undefined, null])(
    "旧レコードの不明な request_timestamp (%s) は null にする",
    (value) => {
      const raw: Record<string, unknown> = { ...makeRawVideo(), request_timestamp: value };
      if (value === undefined) delete raw.request_timestamp;
      const result = parse(raw);
      expect(result).not.toBeNull();
      expect(result?.requestTimestamp).toBeNull();
      expect(raw.request_timestamp).toBe(value);
    },
  );

  it("数値の request_timestamp は許容しない", () => {
    expect(parse({ ...makeRawVideo(), request_timestamp: 1690000000 })).toBeNull();
  });

  it("型が不正な値（video_id が数値）は null を返す", () => {
    const raw: Record<string, unknown> = { ...makeRawVideo(), video_id: 123 };
    expect(parse(raw)).toBeNull();
  });

  it("upload_status が enum 外の値は null を返す", () => {
    const raw: Record<string, unknown> = { ...makeRawVideo(), upload_status: "unknown" };
    expect(parse(raw)).toBeNull();
  });

  it("upload_status=init も検証を通す", () => {
    const result = parse(makeRawVideo({ upload_status: "init" }));
    expect(result?.uploadStatus).toBe("init");
  });

  it("未知の追加フィールドは無視して検証を通す（後方互換）", () => {
    const raw = { ...makeRawVideo(), extra_field: "ignored" };
    const result = parse(raw);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("extra_field");
  });

  it("null / 非オブジェクトは null を返す", () => {
    expect(parse(null)).toBeNull();
    expect(parse("not an object")).toBeNull();
    expect(parse(42)).toBeNull();
  });
});
