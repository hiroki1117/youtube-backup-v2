import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PlaylistRegistration } from "@/components/PlaylistRegistration";
import { makeRawYoutubePlaylist, makeRawYoutubePlaylistVideo } from "@/test/factories";
import { parseYoutubePlaylist, type YoutubePlaylist } from "@/types/youtubePlaylist";

/**
 * 再生リストからの一括登録（登録ダイアログの中の 確認 → 登録中 → 結果）。
 * 状態は usePlaylistRegistration が持つため、ここでは各 step を props で直接与える。
 * 実際のダイアログ内での表示は Components/RegisterDialog の Playlist* を参照。
 */
function playlistOf(count: number, unavailableCount = 0): YoutubePlaylist {
  const videos = Array.from({ length: count }, (_, i) =>
    makeRawYoutubePlaylistVideo(`pv${i + 1}`, `再生リストの動画 ${i + 1}`),
  );
  const playlist = parseYoutubePlaylist(makeRawYoutubePlaylist(videos, unavailableCount));
  if (playlist === null) {
    throw new Error("invalid playlist fixture");
  }
  return playlist;
}

const playlist = playlistOf(24, 2);

const meta = {
  title: "Components/PlaylistRegistration",
  component: PlaylistRegistration,
  decorators: [
    (Story) => (
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    state: { step: "preview", playlist },
    onRegister: fn(),
    onStop: fn(),
    onBack: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof PlaylistRegistration>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 確認: 本数・除く動画の数・タイトル一覧（長い一覧は枠内でスクロール）。 */
export const Preview: Story = {};

/** 登録できる動画が 1 本もない（すべて非公開・削除済み）。戻るだけを出す。 */
export const PreviewEmpty: Story = {
  args: { state: { step: "preview", playlist: playlistOf(0, 3) } },
};

export const Registering: Story = {
  args: { state: { step: "registering", playlist, done: 9 } },
};

export const Finished: Story = {
  args: {
    state: {
      step: "finished",
      playlist,
      result: { started: 20, existing: 4, failed: [], stopped: false },
    },
  },
};

/** 失敗した動画は理由とともに一覧する。 */
export const FinishedWithFailures: Story = {
  args: {
    state: {
      step: "finished",
      playlist,
      result: {
        started: 20,
        existing: 2,
        failed: [
          {
            video: playlist.videos[3],
            message: "通信に失敗しました。時間をおいて再試行してください。",
          },
          { video: playlist.videos[7], message: "YouTube の動画 URL として認識できません。" },
        ],
        stopped: false,
      },
    },
  },
};

/** 途中で中止: 残りの本数と、もう一度登録すれば続きから入ることを伝える。 */
export const Stopped: Story = {
  args: {
    state: {
      step: "finished",
      playlist,
      result: { started: 9, existing: 0, failed: [], stopped: true },
    },
  },
};
