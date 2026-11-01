import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SearchHistory } from "@/components/SearchHistory";
import { EMPTY_FILTERS, type SearchFilters } from "@/lib/search";
import { createEntry } from "@/lib/searchHistory";

const TODAY = new Date(2026, 10, 1);

const entry = (filters: Partial<SearchFilters>, title?: string) =>
  createEntry(
    { ...EMPTY_FILTERS, ...filters },
    title === undefined ? [] : [{ videoId: "dQw4w9WgXcQ", title }],
    TODAY,
  );

const ENTRIES = [
  entry({ text: "猫 まとめ" }),
  entry({ text: "猫", from: "2026-01-01", to: "2026-11-01" }),
  entry({ from: "2026-10-26", to: "2026-11-01" }),
  entry({ text: "ライブ", from: "2026-08-01", to: "2026-08-31" }),
  entry({ from: "2025-12-01" }),
  entry({ text: "https://youtu.be/dQw4w9WgXcQ" }, "猫の動画まとめ 2026"),
  entry({
    text: "長い検索語を入力した場合でも行の高さを変えずに一行で省略して表示する例の検索語です",
  }),
  entry({ text: "dQw4w9WgXcQ" }, ""),
];

/** 検索の種類ごとの表示名と、スマホ幅での省略を確かめる。 */
const meta = {
  title: "Components/SearchHistory",
  component: SearchHistory,
  args: { entries: ENTRIES, onSelect: fn(), onRemove: fn(), onClear: fn() },
} satisfies Meta<typeof SearchHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 入力中の絞り込みでは「すべて削除」を出さない。 */
export const Filtered: Story = {
  args: { entries: ENTRIES.slice(0, 2), onClear: undefined },
};
