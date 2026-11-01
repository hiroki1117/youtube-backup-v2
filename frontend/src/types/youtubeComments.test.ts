import { describe, expect, it } from "vitest";
import { parseYoutubeCommentPage } from "@/types/youtubeComments";
import { makeRawYoutubeComment, makeRawYoutubeCommentPage } from "@/test/factories";

describe("YoutubeCommentPage の API 境界", () => {
  it("スレッドと返信をキャメルケースに正規化する", () => {
    const raw = makeRawYoutubeCommentPage(
      [
        {
          ...makeRawYoutubeComment({ is_pinned: true }),
          replies: [makeRawYoutubeComment({ comment_id: "Ugx1.r", parent: "Ugx1", author: null })],
        },
      ],
      20,
    );
    expect(parseYoutubeCommentPage(raw)).toEqual({
      totalThreads: 1,
      totalComments: 2,
      nextOffset: 20,
      threads: [
        {
          commentId: "Ugx1",
          text: "いい動画でした",
          likeCount: 3,
          author: "@viewer",
          authorIsUploader: false,
          isPinned: true,
          postedAt: 1792713600,
          removed: false,
          replies: [
            {
              commentId: "Ugx1.r",
              text: "いい動画でした",
              likeCount: 3,
              author: null,
              authorIsUploader: false,
              isPinned: false,
              postedAt: 1792713600,
              removed: false,
            },
          ],
        },
      ],
    });
  });

  it("YouTube 以外の形や欠けた項目は null を返す（error-path）", () => {
    expect(parseYoutubeCommentPage({ ...makeRawYoutubeCommentPage(), platform: "x" })).toBeNull();
    expect(parseYoutubeCommentPage({ threads: [] })).toBeNull();
  });
});
