import { describe, expect, it } from "vitest";
import {
  isCommentBackupInProgress,
  parseCommentBackup,
  shouldPollCommentBackup,
  supportsCommentBackup,
  type CommentBackupState,
} from "@/types/commentBackup";
import { makeRawCommentBackup } from "@/test/factories";

describe("CommentBackup の API 境界と状態の判定", () => {
  it("件数・完了時刻がない応答は null に正規化する", () => {
    expect(parseCommentBackup(makeRawCommentBackup())).toEqual({
      videoId: "v1",
      platform: "youtube",
      state: "not_started",
      commentCount: null,
      completedAt: null,
    });
  });

  it("形が不正な応答は null を返す（error-path）", () => {
    expect(parseCommentBackup({ video_id: "v1" })).toBeNull();
  });

  it.each<[CommentBackupState, boolean, boolean]>([
    ["not_started", false, false],
    ["submitting", true, true],
    ["running", true, true],
    ["awaiting_ingest", false, true],
    ["complete", false, false],
    ["failed", false, false],
  ])("%s: 開始不可=%s、照会を繰り返す=%s", (state, inProgress, poll) => {
    expect(isCommentBackupInProgress(state)).toBe(inProgress);
    expect(shouldPollCommentBackup(state)).toBe(poll);
  });

  it("対応プラットフォームは YouTube だけ", () => {
    expect(supportsCommentBackup("youtube")).toBe(true);
    expect(supportsCommentBackup("twitter")).toBe(false);
  });
});
