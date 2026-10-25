import { describe, expect, it } from "vitest";
import { parseYoutubePlaylist } from "@/types/youtubePlaylist";
import { makeRawYoutubePlaylist, makeRawYoutubePlaylistVideo } from "@/test/factories";

describe("YoutubePlaylist の API 境界", () => {
  it("キャメルケースに正規化し、並び順を保つ", () => {
    const raw = makeRawYoutubePlaylist(
      [makeRawYoutubePlaylistVideo("b", "二本目"), makeRawYoutubePlaylistVideo("a", "一本目")],
      2,
    );
    expect(parseYoutubePlaylist(raw)).toEqual({
      playlistId: "PLtest",
      videos: [
        { videoId: "b", url: "https://www.youtube.com/watch?v=b", title: "二本目" },
        { videoId: "a", url: "https://www.youtube.com/watch?v=a", title: "一本目" },
      ],
      unavailableCount: 2,
    });
  });

  it("形が違えば null", () => {
    expect(parseYoutubePlaylist({ playlist_id: "PLtest", videos: [{}] })).toBeNull();
    expect(parseYoutubePlaylist(null)).toBeNull();
  });
});
