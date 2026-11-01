/**
 * 検索条件の純粋関数（U3 video-search）。条件は URL が持つので、再読み込みや「戻る」でも
 * 同じ結果へ戻れる。副作用・API 依存を持たない leaf（lib）に置く。
 */

/** 検索条件。未指定は空文字。日付は YYYY-MM-DD。 */
export interface SearchFilters {
  text: string;
  from: string;
  to: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export const EMPTY_FILTERS: SearchFilters = { text: "", from: "", to: "" };

export type DatePreset = "all" | "week" | "month" | "thisYear" | "lastYear";

/** `short` はスマホ幅の表記。全チップを 1 行に収め、選択中のチップが隠れないようにする。 */
export const DATE_PRESETS: { id: DatePreset; label: string; short: string }[] = [
  { id: "all", label: "すべて", short: "すべて" },
  { id: "week", label: "過去7日", short: "7日" },
  { id: "month", label: "過去30日", short: "30日" },
  { id: "thisYear", label: "今年", short: "今年" },
  { id: "lastYear", label: "去年", short: "去年" },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// date 入力は年の入力途中でも 0002-01-01 のような値を返すので、確定した日付だけを採用する。
const EARLIEST_DATE = "2000-01-01";

export function isCompleteDate(value: string): boolean {
  return DATE_PATTERN.test(value) && value >= EARLIEST_DATE;
}

/** 開始日と終了日が逆なら入れ替える。入力の順序を問わず、利用者を止めないため。 */
export function normalizeRange({ from, to }: DateRange): DateRange {
  return from !== "" && to !== "" && from > to ? { from: to, to: from } : { from, to };
}

export function parseSearchFilters(params: URLSearchParams): SearchFilters {
  const date = (name: string) => {
    const value = params.get(name) ?? "";
    return isCompleteDate(value) ? value : "";
  };
  return { text: params.get("q") ?? "", ...normalizeRange({ from: date("from"), to: date("to") }) };
}

export function toSearchParams({ text, from, to }: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (text !== "") {
    params.set("q", text);
  }
  if (from !== "") {
    params.set("from", from);
  }
  if (to !== "") {
    params.set("to", to);
  }
  return params;
}

export function hasConditions({ text, from, to }: SearchFilters): boolean {
  return text.trim() !== "" || from !== "" || to !== "";
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysBefore(today: Date, days: number): string {
  return formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
}

export function presetRange(preset: DatePreset, today: Date): DateRange {
  const year = today.getFullYear();
  switch (preset) {
    case "all":
      return { from: "", to: "" };
    case "week":
      return { from: daysBefore(today, 6), to: formatDate(today) };
    case "month":
      return { from: daysBefore(today, 29), to: formatDate(today) };
    case "thisYear":
      return { from: `${year}-01-01`, to: formatDate(today) };
    case "lastYear":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

/** 範囲に一致するプリセット。手で指定した範囲は null。 */
export function matchPreset({ from, to }: DateRange, today: Date): DatePreset | null {
  const match = DATE_PRESETS.find(({ id }) => {
    const range = presetRange(id, today);
    return range.from === from && range.to === to;
  });
  return match?.id ?? null;
}

/** 「Re:ゼロ」のようなタイトルも URL として解釈できるため、http(s) だけを URL として扱う。 */
export function isUrlText(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

/** タイトルのハイライトに使う語。URL で検索したときはタイトルと照合しない。 */
export function searchTerms(text: string): string[] {
  return isUrlText(text) ? [] : text.split(/\s+/).filter((term) => term !== "");
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** タイトルを、語に一致する部分とそれ以外に分ける（大文字小文字は区別しない）。 */
export function highlightParts(title: string, terms: string[]): HighlightPart[] {
  if (terms.length === 0) {
    return [{ text: title, match: false }];
  }
  const alternatives = [...terms]
    // 「猫」と「猫動画」のように重なる語は、長いほうを優先する。
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // split はキャプチャした一致部分を奇数番目に残す。
  return title
    .split(new RegExp(`(${alternatives.join("|")})`, "giu"))
    .map((text, index) => ({ text, match: index % 2 === 1 }))
    .filter((part) => part.text !== "");
}
