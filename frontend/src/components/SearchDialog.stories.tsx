import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SearchDialog } from "@/components/SearchDialog";
import { withMemoryRouter, withQueryClient } from "@/test/storybook/decorators";
import { pendingHandler, videoNotFoundHandler } from "@/test/storybook/msw";

/**
 * 動画検索ダイアログ（US-2 / US-5 / US-8）。最小 Provider は QueryClient + MemoryRouter
 * （`useVideoSearch` と `useNavigate` の実依存）。API は MSW（既定: GET /videos/:id が complete 動画）。
 *
 * `play` は「状態セットアップ専用」（入力・送信のみ、assertion なし）。検索結果は内部 state に
 * 依存するため props だけでは到達できない。assertion 付き interaction test は不採用（team.md）。
 *
 * a11y 注記: 独自モーダルで focus trap / Esc クローズ / scroll-lock は未実装。axe 非検出のため
 * 手動キーボード検証を要する。
 */
const meta = {
  title: "Components/SearchDialog",
  component: SearchDialog,
  decorators: [withQueryClient, withMemoryRouter],
  args: {
    open: true,
    onClose: fn(),
  },
  parameters: {
    router: { initialEntries: ["/videos"] },
  },
} satisfies Meta<typeof SearchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 状態セットアップ: 検索語を入力して送信する（空文字は入力せず送信のみ）。 */
async function submitSearch(canvasElement: HTMLElement, query: string): Promise<void> {
  const canvas = within(canvasElement);
  if (query !== "") {
    await userEvent.type(canvas.getByLabelText("動画 ID または YouTube URL"), query);
  }
  await userEvent.click(canvas.getByRole("button", { name: "検索" }));
}

export const Open: Story = {};

/** 既定ハンドラ（complete 動画）→ 結果 + 「再生ページへ」。 */
export const Found: Story = {
  play: async ({ canvasElement }) => {
    await submitSearch(canvasElement, "v1");
  },
};

export const NotFound: Story = {
  parameters: {
    msw: { handlers: [videoNotFoundHandler()] },
  },
  play: async ({ canvasElement }) => {
    await submitSearch(canvasElement, "missing");
  },
};

export const Loading: Story = {
  parameters: {
    msw: { handlers: [pendingHandler("get", "/videos/:videoId")] },
  },
  play: async ({ canvasElement }) => {
    await submitSearch(canvasElement, "v1");
  },
};

/** 空入力で送信 → クライアント検証エラー（API は呼ばれない）。 */
export const InvalidInput: Story = {
  play: async ({ canvasElement }) => {
    await submitSearch(canvasElement, "");
  },
};
