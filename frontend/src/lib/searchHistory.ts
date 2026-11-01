import { z } from "zod";
import {
  DATE_PRESETS,
  isUrlText,
  matchPreset,
  presetRange,
  searchTerms,
  type SearchFilters,
} from "@/lib/search";
import type { Video } from "@/types/video";

/**
 * 検索履歴の純粋関数（U3 video-search）。保存は useSearchHistory が担い、ここは「何を 1 件として
 * 残すか」と「どう表示するか」だけを決める。
 *
 * - 期間プリセットは日付ではなくプリセットのまま持つ。「今年」は来年押しても今年を指すようにする。
 * - URL と動画 ID は動画を指す検索として持つ。URL の形が違っても同じ動画なら 1 件にまとめ、
 *   読めない URL の代わりに動画のタイトルで表示する。
 * - 同じ条件は 1 件にまとめて先頭へ移す。語を足す・期間を変えるなど、同じ検索の調整は
 *   途中経過を残さず最後の条件だけを残す。
 */

// 履歴の上限。超えたら古いものから消える。
const MAX_ENTRIES = 30;
// 新しく作った履歴がこの時間内に調整されたら、同じ検索の途中経過として置き換える。
const REFINE_WINDOW_MS = 5 * 60 * 1000;

const entrySchema = z.object({
  text: z.string(),
  from: z.string(),
  to: z.string(),
  preset: z.enum(["week", "month", "thisYear", "lastYear"]).nullable(),
  video: z.object({ id: z.string(), title: z.string() }).nullable(),
  createdAt: z.number(),
});

export type SearchHistoryEntry = z.infer<typeof entrySchema>;

export type SearchHistoryKind = "text" | "date" | "video";

export interface SearchHistoryLabel {
  kind: SearchHistoryKind;
  title: string;
  detail: string | null;
}

/** 保存値を読む。壊れた値は履歴なしとして扱う。 */
export function parseEntries(raw: string): SearchHistoryEntry[] {
  try {
    const parsed = z.array(entrySchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** 語を入力せず動画そのものを指した検索なら、その動画を返す。 */
function directVideo(
  { text, from, to }: SearchFilters,
  videos: Pick<Video, "videoId" | "title">[],
) {
  const [video] = videos;
  if (videos.length !== 1) {
    return null;
  }
  const isVideoId = video.videoId === text.trim() && from === "" && to === "";
  return isUrlText(text) || isVideoId ? video : null;
}

/** 結果の出た検索から履歴を作る。 */
export function createEntry(
  filters: SearchFilters,
  videos: Pick<Video, "videoId" | "title">[],
  now: Date,
): SearchHistoryEntry {
  const createdAt = now.getTime();
  const video = directVideo(filters, videos);
  if (video !== null) {
    return {
      text: filters.text.trim(),
      from: "",
      to: "",
      preset: null,
      video: { id: video.videoId, title: video.title },
      createdAt,
    };
  }
  const text = searchTerms(filters.text).join(" ");
  const preset = matchPreset(filters, now);
  return preset === null || preset === "all"
    ? { text, from: filters.from, to: filters.to, preset: null, video: null, createdAt }
    : { text, from: "", to: "", preset, video: null, createdAt };
}

/** 履歴から検索条件を復元する。プリセットは `today` を基準に計算し直す。 */
export function entryFilters({ text, from, to, preset }: SearchHistoryEntry, today: Date) {
  const range = preset === null ? { from, to } : presetRange(preset, today);
  return { text, ...range } satisfies SearchFilters;
}

/** 同じ検索かどうかの判定キー。 */
export function entryKey({ text, from, to, preset, video }: SearchHistoryEntry): string {
  return video !== null
    ? `video:${video.id}`
    : JSON.stringify([text.toLowerCase(), preset, from, to]);
}

function entryTerms({ text }: SearchHistoryEntry): string[] {
  return searchTerms(text.toLowerCase());
}

function covers(terms: string[], others: string[]): boolean {
  return terms.every((term) => others.some((other) => other.includes(term)));
}

/** `next` が `latest` を調整した検索か。動画を指す検索と、語のある検索・ない検索の間は別物。 */
function isRefinement(latest: SearchHistoryEntry, next: SearchHistoryEntry): boolean {
  if (
    latest.video !== null ||
    next.video !== null ||
    next.createdAt - latest.createdAt >= REFINE_WINDOW_MS
  ) {
    return false;
  }
  const [latestTerms, nextTerms] = [entryTerms(latest), entryTerms(next)];
  if ((latestTerms.length === 0) !== (nextTerms.length === 0)) {
    return false;
  }
  return covers(latestTerms, nextTerms) || covers(nextTerms, latestTerms);
}

/** 履歴を先頭へ追加する。同じ条件はまとめ、調整中の直前の履歴は置き換える。 */
export function addEntry(
  entries: SearchHistoryEntry[],
  entry: SearchHistoryEntry,
): SearchHistoryEntry[] {
  const key = entryKey(entry);
  const existing = entries.find((candidate) => entryKey(candidate) === key);
  if (existing !== undefined) {
    // 作成時刻を保つので、以前からの履歴を開き直しても調整の途中経過として消されない。
    const merged = { ...entry, createdAt: existing.createdAt };
    return [merged, ...entries.filter((candidate) => candidate !== existing)];
  }
  const [latest, ...older] = entries;
  const kept = latest !== undefined && isRefinement(latest, entry) ? older : entries;
  return [entry, ...kept].slice(0, MAX_ENTRIES);
}

export function removeEntry(
  entries: SearchHistoryEntry[],
  entry: SearchHistoryEntry,
): SearchHistoryEntry[] {
  const key = entryKey(entry);
  return entries.filter((candidate) => entryKey(candidate) !== key);
}

function formatDay(value: string, sameYearAs?: string): string {
  const [year, month, day] = value.split("-");
  const monthDay = `${Number(month)}/${Number(day)}`;
  return sameYearAs?.startsWith(year) === true ? monthDay : `${year}/${monthDay}`;
}

function dateLabel({ from, to, preset }: SearchHistoryEntry): string | null {
  if (preset !== null) {
    return DATE_PRESETS.find(({ id }) => id === preset)?.label ?? null;
  }
  if (from !== "" && to !== "") {
    return from === to ? formatDay(from) : `${formatDay(from)}〜${formatDay(to, from)}`;
  }
  if (from !== "") {
    return `${formatDay(from)} 以降`;
  }
  return to !== "" ? `${formatDay(to)} 以前` : null;
}

/** どんな検索だったかが分かる表示名。 */
export function describeEntry(entry: SearchHistoryEntry): SearchHistoryLabel {
  const { text, video } = entry;
  if (video !== null) {
    const id = `動画 ID: ${video.id}`;
    return video.title === ""
      ? { kind: "video", title: id, detail: null }
      : { kind: "video", title: video.title, detail: id };
  }
  const date = dateLabel(entry);
  const backup = date === null ? null : `${date}にバックアップ`;
  return text === ""
    ? { kind: "date", title: backup ?? "", detail: null }
    : { kind: "text", title: text, detail: backup };
}

/** 入力中の語をすべて含む履歴に絞る。 */
export function filterEntries(entries: SearchHistoryEntry[], draft: string): SearchHistoryEntry[] {
  const terms = searchTerms(draft.toLowerCase());
  return entries.filter((entry) => {
    const { title, detail } = describeEntry(entry);
    const label = `${title} ${detail ?? ""}`.toLowerCase();
    return terms.every((term) => label.includes(term));
  });
}
