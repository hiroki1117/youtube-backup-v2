import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { RegisterDialog } from "@/components/RegisterDialog";
import { withQueryClient } from "@/test/storybook/decorators";
import { pendingHandler } from "@/test/storybook/msw";

/**
 * 動画登録ダイアログ（US-2 / US-5 / US-8）。最小 Provider は QueryClient（`useVideoRegistration`）。
 *
 * `play` は「状態セットアップ専用」（入力・送信のみ、assertion なし）。バリデーションエラー・送信中は
 * 内部 state に依存するため props だけでは到達できない。assertion 付き interaction test は不採用（team.md）。
 *
 * a11y 注記: 独自モーダルで focus trap / Esc クローズ / scroll-lock は未実装。axe 非検出のため
 * 手動キーボード検証を要する。
 */
const meta = {
  title: "Components/RegisterDialog",
  component: RegisterDialog,
  decorators: [withQueryClient],
  args: {
    open: true,
    onClose: fn(),
  },
} satisfies Meta<typeof RegisterDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 状態セットアップ: URL を入力して登録を送信する。 */
async function submitUrl(canvasElement: HTMLElement, url: string): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText("動画 URL"), url);
  await userEvent.click(canvas.getByRole("button", { name: "登録" }));
}

export const Open: Story = {};

/** 非 https の URL を送信 → クライアント検証エラー（API は呼ばれない / NFR4）。 */
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    await submitUrl(canvasElement, "http://www.youtube.com/watch?v=dQw4w9WgXcQ");
  },
};

/** POST /video を保留し、送信中（ボタン無効 + `aria-busy`）を固定する。 */
export const Submitting: Story = {
  parameters: {
    msw: { handlers: [pendingHandler("post", "/videos")] },
  },
  play: async ({ canvasElement }) => {
    await submitUrl(canvasElement, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  },
};
