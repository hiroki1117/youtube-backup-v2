import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchPage } from "@/app/SearchPage";
import { makeRawVideo, makeRawVideos } from "@/test/factories";
import { withAppRoutes } from "@/test/storybook/decorators";
import {
  networkErrorHandler,
  pendingHandler,
  searchResultsHandler,
  videoNotFoundHandler,
} from "@/test/storybook/msw";

/**
 * 検索ページ。条件は URL が持つので、各バリアントは `parameters.router` の URL で再現できる。
 * タイトルの検索を確かめるため、動画 ID の直接取得は既定で 404 にする。
 */
const meta = {
  title: "Pages/SearchPage",
  component: SearchPage,
  decorators: [withAppRoutes],
  parameters: {
    layout: "fullscreen",
    auth: "authenticated",
    router: { initialEntries: ["/search"] },
  },
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const RESULTS = [
  makeRawVideo({ video_id: "v1", title: "猫の動画まとめ 2026", backupdate: "2026-10-03" }),
  makeRawVideo({
    video_id: "v2",
    title:
      "長いタイトルの猫動画：スマホ幅では2行まで表示して、一致した語を見比べられるようにする例",
    backupdate: "2026-09-21",
  }),
  makeRawVideo({
    video_id: "v3",
    title: "処理中の猫",
    backupdate: "2026-09-02",
    upload_status: "init",
  }),
];

/** 条件なし: 使い方を示す。 */
export const Idle: Story = {};

/** タイトルの検索結果。一致部分を強調する。 */
export const Results: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=%E7%8C%AB"] },
    msw: { handlers: [videoNotFoundHandler(), searchResultsHandler(RESULTS)] },
  },
};

/** 語と期間プリセットの組み合わせ（今年の範囲は実行日で変わるので過去の固定範囲で示す）。 */
export const CustomDateRange: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=%E7%8C%AB&from=2026-09-01&to=2026-10-31"] },
    msw: { handlers: [searchResultsHandler(RESULTS)] },
  },
};

/** 上限を超えた場合は、条件を絞るよう案内する。 */
export const TooMany: Story = {
  parameters: {
    router: { initialEntries: ["/search?from=2026-01-01&to=2026-10-31"] },
    msw: { handlers: [searchResultsHandler(makeRawVideos(100), true)] },
  },
};

export const NotFound: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=nothing"] },
    msw: { handlers: [videoNotFoundHandler()] },
  },
};

export const Loading: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=%E7%8C%AB"] },
    msw: { handlers: [videoNotFoundHandler(), pendingHandler("get", "/search/videos")] },
  },
};

export const InvalidUrl: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=https%3A%2F%2Fexample.com%2Fwatch"] },
  },
};

export const NetworkError: Story = {
  parameters: {
    router: { initialEntries: ["/search?q=%E7%8C%AB"] },
    msw: { handlers: [videoNotFoundHandler(), networkErrorHandler("get", "/search/videos")] },
  },
};
