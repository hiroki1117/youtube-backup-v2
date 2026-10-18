import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { VideoCatalog } from "@/components/VideoCatalog";
import { makeVideos } from "@/test/factories";

/**
 * 状態別動画一覧（presentational、props 駆動）（US-2）。
 * データは factories の合成値のみ。行アクションは `handlers` の有無で表示が変わる（C6）。
 */
const completeVideos = makeVideos([
  { title: "完了動画1", platform: "youtube", backupDate: "2026-08-03" },
  { title: "完了動画2", platform: "twitter", backupDate: "2026-08-02" },
  { title: "完了動画3", platform: "youtube", backupDate: "2026-08-01" },
]);

const mixedVideos = makeVideos([
  { title: "完了動画1", platform: "youtube", backupDate: "2026-08-03" },
  { title: "処理中動画1", platform: "youtube", backupDate: "2026-07-25", uploadStatus: "init" },
  { title: "完了動画2", platform: "twitter", backupDate: "2026-08-02" },
  { title: "処理中動画2", platform: "twitter", backupDate: "2026-07-20", uploadStatus: "init" },
]);

const meta = {
  title: "Components/VideoCatalog",
  component: VideoCatalog,
  args: {
    onRetry: fn(),
  },
} satisfies Meta<typeof VideoCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  args: { state: { status: "ready", data: completeVideos } },
};

/** 行アクション（再生 / ダウンロード / 削除）を全て配線した形（VideosPage の実配線と同じ）。 */
export const ListWithActions: Story = {
  args: {
    state: { status: "ready", data: completeVideos },
    handlers: { onPlay: fn(), onDownload: fn(), onDelete: fn() },
  },
};

/** complete / init 混在。init 行にはダウンロードが出ない（A3）。 */
export const MixedStatuses: Story = {
  args: {
    state: { status: "ready", data: mixedVideos },
    handlers: { onPlay: fn(), onDownload: fn(), onDelete: fn() },
  },
};

/** 続きがある一覧（「もっと見る」を表示）。 */
export const HasMore: Story = {
  args: {
    state: { status: "ready", data: completeVideos },
    hasMore: true,
    onLoadMore: fn(),
  },
};

/** 続きを読み込み中（「もっと見る」は無効）。 */
export const LoadingMore: Story = {
  args: {
    state: { status: "ready", data: completeVideos },
    hasMore: true,
    onLoadMore: fn(),
    isLoadingMore: true,
  },
};

export const Empty: Story = {
  args: { state: { status: "empty", variant: "nodata" } },
};

export const EmptyFiltered: Story = {
  args: { state: { status: "empty", variant: "filtered" } },
};

export const Loading: Story = {
  args: { state: { status: "loading" } },
};

export const Error: Story = {
  args: { state: { status: "error", message: "動画一覧の取得に失敗しました" } },
};
