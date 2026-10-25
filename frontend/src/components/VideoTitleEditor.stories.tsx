import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { VideoTitleEditor } from "@/components/VideoTitleEditor";

/**
 * 動画タイトルのインライン編集フォーム。Enter / 保存で確定、Esc / キャンセルで破棄する。
 * 未変更・空白のみ・保存中は保存ボタンが無効になる。
 */
const meta = {
  title: "Components/VideoTitleEditor",
  component: VideoTitleEditor,
  args: {
    title: "【テスト】サンプル動画のタイトル",
    isSaving: false,
    onSave: fn(async () => true),
    onCancel: fn(),
  },
} satisfies Meta<typeof VideoTitleEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

/** 保存実行中: 入力・ボタンが無効化され、保存ボタンが「保存中...」になる。 */
export const Saving: Story = {
  args: { isSaving: true },
};
