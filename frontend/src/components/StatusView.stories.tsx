import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { StatusView } from "@/components/StatusView";

/**
 * UiStateKit StatusView の 4 状態（loading / error / empty / ready）（US-2）。
 * `state` は discriminated union で、表示テキストでは分岐しない。
 */
const meta = {
  title: "Components/StatusView",
  component: StatusView,
  args: {
    children: (data: unknown) => <p className="p-4 text-sm">{String(data)}</p>,
  },
} satisfies Meta<typeof StatusView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { state: { status: "loading" } },
};

export const LoadingCustomLabel: Story = {
  args: { state: { status: "loading" }, loadingLabel: "動画一覧を読み込んでいます..." },
};

export const Error: Story = {
  args: {
    state: { status: "error", message: "通信に失敗しました。時間をおいて再試行してください。" },
  },
};

export const ErrorWithRetry: Story = {
  args: {
    state: { status: "error", message: "通信に失敗しました。時間をおいて再試行してください。" },
    onRetry: fn(),
  },
};

export const EmptyNodata: Story = {
  args: { state: { status: "empty", message: "データがありません" } },
};

export const EmptyFiltered: Story = {
  args: { state: { status: "empty", message: "条件に一致するデータがありません" } },
};

export const Ready: Story = {
  args: { state: { status: "ready", data: "取得したデータをここに描画します" } },
};
