import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { VideosPage } from "@/app/VideosPage";
import { makeRawVideo, makeRawVideos } from "@/test/factories";
import { COMPLETE_RAW_VIDEOS } from "@/test/handlers";
import { withAppRoutes } from "@/test/storybook/decorators";
import {
  emptyListHandler,
  listErrorHandler,
  listVideosByStatusHandler,
  listVideosHandler,
  pendingHandler,
} from "@/test/storybook/msw";

/**
 * 動画一覧ページ（US-3 中核 / US-11）。
 * `withAppRoutes` が実ルート定義（RequireAuth → AppShell → VideosPage）を memory router で描画するため、
 * AppShell ヘッダを含む「ページ全体の様子」を実装と同じ配線で確認できる。
 * 各バリアントは `parameters.msw.handlers`（API 応答）で制御し、エラー系は既存 API 規約
 * （HTTP 200 + `result:"error"` + 日本語 description）に従う。
 *
 * `play` は「状態セットアップ専用」（操作のみ、assertion なし）。
 */
const meta = {
  title: "Pages/VideosPage",
  component: VideosPage,
  decorators: [withAppRoutes],
  parameters: {
    layout: "fullscreen",
    auth: "authenticated",
    router: { initialEntries: ["/videos"] },
  },
} satisfies Meta<typeof VideosPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定ハンドラ: complete 3 件。 */
export const List: Story = {};

/** 45 件 → 3 ページ（1 ページ 20 件）。 */
export const MultiPage: Story = {
  parameters: {
    msw: { handlers: [listVideosHandler(makeRawVideos(45))] },
  },
};

/**
 * 長いタイトル（日本語の長文・空白のない英数字や URL）。スマホ幅で行が画面からはみ出さず、
 * タイトルが省略表示になることを確かめる。
 */
export const LongTitles: Story = {
  parameters: {
    msw: {
      handlers: [
        listVideosHandler([
          makeRawVideo({
            video_id: "v1",
            title:
              "【完全版】とても長い日本語のタイトルの動画がスマホの一覧でどう見えるかを確かめるためのサンプル",
          }),
          makeRawVideo({
            video_id: "v2",
            platform: "twitter",
            title: "https://twitter.com/example_user_name/status/1234567890123456789",
          }),
          makeRawVideo({
            video_id: "v3",
            title: "Supercalifragilisticexpialidocious_without_any_spaces_at_all_0123456789",
          }),
        ]),
      ],
    },
  },
};

/** 既定フィルタ（complete）で 0 件 → nodata 表示。 */
export const Empty: Story = {
  parameters: {
    msw: { handlers: [emptyListHandler()] },
  },
};

/** 「処理中」フィルタへ切り替えると 0 件 → filtered 表示。 */
export const FilteredEmpty: Story = {
  parameters: {
    msw: { handlers: [listVideosByStatusHandler({ complete: COMPLETE_RAW_VIDEOS, init: [] })] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "処理中" }));
  },
};

export const Loading: Story = {
  parameters: {
    msw: { handlers: [pendingHandler("get", "/videos")] },
  },
};

/**
 * 一覧取得の失敗。GET /video は成功時に裸配列を返す契約のため、エラーエンベロープは ApiClient で
 * 配列不一致の transport 失敗として扱われ、その内部メッセージがそのまま表示される（実挙動）。
 */
export const Error: Story = {
  parameters: {
    msw: { handlers: [listErrorHandler()] },
  },
};
