import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CommentBackupPanel } from "@/components/CommentBackupPanel";
import type { CommentBackup } from "@/types/commentBackup";

/** コメントのバックアップ欄（動画再生ページの詳細の下に出す presentational）。 */
const base: CommentBackup = {
  videoId: "v1",
  platform: "youtube",
  state: "not_started",
  commentCount: null,
  completedAt: null,
};

const meta = {
  title: "Components/CommentBackupPanel",
  component: CommentBackupPanel,
  args: {
    state: { status: "ready", data: base },
    isStarting: false,
    onStart: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof CommentBackupPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotStarted: Story = {};

export const Running: Story = {
  args: {
    state: {
      status: "ready",
      data: { ...base, state: "running", commentCount: 120, completedAt: 1792713600 },
    },
  },
};

export const Complete: Story = {
  args: {
    state: {
      status: "ready",
      data: { ...base, state: "complete", commentCount: 246, completedAt: 1792713600 },
    },
  },
};

export const Failed: Story = {
  args: { state: { status: "ready", data: { ...base, state: "failed" } } },
};

export const Loading: Story = {
  args: { state: { status: "loading" } },
};

export const Error: Story = {
  args: {
    state: { status: "error", message: "通信に失敗しました。時間をおいて再試行してください。" },
  },
};
