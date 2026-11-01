import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, type SearchFilters } from "./search";
import {
  addEntry,
  createEntry,
  describeEntry,
  entryFilters,
  filterEntries,
  parseEntries,
  removeEntry,
  type SearchHistoryEntry,
} from "./searchHistory";

const NOW = new Date(2026, 10, 1, 12); // 2026-11-01 12:00
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);

function entry(
  filters: Partial<SearchFilters>,
  at = NOW,
  videos: { videoId: string; title: string }[] = [],
): SearchHistoryEntry {
  return createEntry({ ...EMPTY_FILTERS, ...filters }, videos, at);
}

const titles = (entries: SearchHistoryEntry[]) => entries.map((e) => describeEntry(e).title);

describe("履歴の作成と復元", () => {
  it("期間プリセットは日付ではなくプリセットとして持ち、選んだ日を基準に計算し直す", () => {
    const thisYear = entry({ from: "2026-01-01", to: "2026-11-01" });

    expect(thisYear.preset).toBe("thisYear");
    expect(entryFilters(thisYear, new Date(2027, 1, 3))).toEqual({
      text: "",
      from: "2027-01-01",
      to: "2027-02-03",
    });
  });

  it("手で指定した範囲はそのまま復元する", () => {
    const custom = entry({ text: "猫", from: "2026-08-01", to: "2026-08-31" });

    expect(custom.preset).toBeNull();
    expect(entryFilters(custom, NOW)).toEqual({
      text: "猫",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("語の空白は保存時に整える", () => {
    expect(entry({ text: " 猫　 まとめ " }).text).toBe("猫 まとめ");
  });

  it("URL の検索は動画を指す履歴にし、再実行できるよう入力も残す", () => {
    const url = "https://youtu.be/abc?t=30";
    const video = entry({ text: url, from: "2026-08-01" }, NOW, [
      { videoId: "abc", title: "猫の動画" },
    ]);

    expect(video.video).toEqual({ id: "abc", title: "猫の動画" });
    expect(entryFilters(video, NOW)).toEqual({ text: url, from: "", to: "" });
  });

  it("動画 ID に完全一致した検索だけを動画を指す履歴にする", () => {
    const direct = [{ videoId: "abc", title: "猫の動画" }];

    expect(entry({ text: "abc" }, NOW, direct).video).not.toBeNull();
    expect(entry({ text: "ab" }, NOW, direct).video).toBeNull();
    expect(entry({ text: "abc", from: "2026-08-01" }, NOW, direct).video).toBeNull();
  });
});

describe("履歴の蓄積", () => {
  it("新しい検索を先頭に積む", () => {
    const entries = addEntry([entry({ text: "猫" })], entry({ text: "犬" }));

    expect(titles(entries)).toEqual(["犬", "猫"]);
  });

  it("同じ条件は大文字小文字と空白を問わず 1 件にまとめて先頭へ移す", () => {
    const entries = addEntry(
      [entry({ text: "犬" }), entry({ text: "Neon  DB" })],
      entry({ text: "neon db" }, minutesLater(60)),
    );

    expect(titles(entries)).toEqual(["neon db", "犬"]);
  });

  it("URL の形が違っても同じ動画なら 1 件にまとめる", () => {
    const video = [{ videoId: "abc", title: "猫の動画" }];
    const entries = addEntry(
      [entry({ text: "https://youtu.be/abc" }, NOW, video)],
      entry({ text: "https://www.youtube.com/watch?v=abc&t=3" }, NOW, video),
    );

    expect(entries).toHaveLength(1);
  });

  it.each<[string, Partial<SearchFilters>, Partial<SearchFilters>]>([
    ["語を足す", { text: "猫" }, { text: "猫 まとめ" }],
    ["語をつなげて入力し直す", { text: "猫" }, { text: "猫動画" }],
    ["語を減らす", { text: "猫 まとめ" }, { text: "猫" }],
    ["語のまま期間を変える", { text: "猫" }, { text: "猫", from: "2026-08-01" }],
    ["期間だけを変える", { from: "2026-08-01" }, { from: "2026-09-01" }],
  ])("%s調整は最後の条件だけを残す", (_, first, second) => {
    const latest = entry(second, minutesLater(4));

    expect(addEntry([entry(first)], latest)).toEqual([latest]);
  });

  it("時間が経てば同じ語を含んでいても別の検索として残す", () => {
    const entries = addEntry(
      [entry({ text: "猫" })],
      entry({ text: "猫 まとめ" }, minutesLater(5)),
    );

    expect(titles(entries)).toEqual(["猫 まとめ", "猫"]);
  });

  it("語が重ならない検索は続けても残す", () => {
    const entries = addEntry([entry({ text: "猫" })], entry({ text: "犬" }, minutesLater(1)));

    expect(entries).toHaveLength(2);
  });

  it("語を消して期間だけにしても、語のある検索は残す", () => {
    const entries = addEntry(
      [entry({ text: "猫", from: "2026-08-01" })],
      entry({ from: "2026-08-01" }, minutesLater(1)),
    );

    expect(entries).toHaveLength(2);
  });

  it("以前からの履歴を開き直した直後の調整では、その履歴を消さない", () => {
    const old = entry({ text: "猫" });
    const reopened = addEntry([old], entry({ text: "猫" }, minutesLater(600)));
    const entries = addEntry(reopened, entry({ text: "猫 まとめ" }, minutesLater(601)));

    expect(titles(entries)).toEqual(["猫 まとめ", "猫"]);
  });

  it("上限を超えたら古いものから消える", () => {
    const entries = Array.from({ length: 35 }).reduce<SearchHistoryEntry[]>(
      (current, _, index) =>
        addEntry(current, entry({ text: `語${index}` }, minutesLater(index * 10))),
      [],
    );

    expect(entries).toHaveLength(30);
    expect(entries[0].text).toBe("語34");
    expect(entries.at(-1)?.text).toBe("語5");
  });

  it("指定した履歴だけを消す", () => {
    const [cat, dog] = [entry({ text: "猫" }), entry({ text: "犬" })];

    expect(titles(removeEntry([cat, dog], cat))).toEqual(["犬"]);
  });
});

describe("履歴の表示名", () => {
  it("語だけの検索は語をそのまま示す", () => {
    expect(describeEntry(entry({ text: "猫 まとめ" }))).toEqual({
      kind: "text",
      title: "猫 まとめ",
      detail: null,
    });
  });

  it("語と期間は語を主にして期間を添える", () => {
    expect(describeEntry(entry({ text: "猫", from: "2026-01-01", to: "2026-11-01" }))).toEqual({
      kind: "text",
      title: "猫",
      detail: "今年にバックアップ",
    });
  });

  it.each([
    [{ from: "2026-10-26", to: "2026-11-01" }, "過去7日にバックアップ"],
    [{ from: "2026-08-01", to: "2026-08-31" }, "2026/8/1〜8/31にバックアップ"],
    [{ from: "2025-12-01", to: "2026-01-31" }, "2025/12/1〜2026/1/31にバックアップ"],
    [{ from: "2026-08-01", to: "2026-08-01" }, "2026/8/1にバックアップ"],
    [{ from: "2026-08-01" }, "2026/8/1 以降にバックアップ"],
    [{ to: "2026-08-31" }, "2026/8/31 以前にバックアップ"],
  ])("期間だけの検索は期間を表示名にする %o", (range, title) => {
    expect(describeEntry(entry(range))).toEqual({ kind: "date", title, detail: null });
  });

  it("URL の検索は動画のタイトルと動画 ID で示す", () => {
    const video = entry({ text: "https://youtu.be/abc" }, NOW, [
      { videoId: "abc", title: "猫の動画" },
    ]);

    expect(describeEntry(video)).toEqual({
      kind: "video",
      title: "猫の動画",
      detail: "動画 ID: abc",
    });
  });

  it("タイトルのない動画は動画 ID で示す", () => {
    const video = entry({ text: "abc" }, NOW, [{ videoId: "abc", title: "" }]);

    expect(describeEntry(video)).toEqual({ kind: "video", title: "動画 ID: abc", detail: null });
  });
});

describe("履歴の絞り込みと保存値", () => {
  it("入力中の語をすべて含む履歴に絞る（表示名の期間やタイトルも対象）", () => {
    const entries = [
      entry({ text: "猫 まとめ" }),
      entry({ text: "Neon" }),
      entry({ text: "犬", from: "2026-01-01", to: "2026-11-01" }),
      entry({ text: "https://youtu.be/abc" }, NOW, [{ videoId: "abc", title: "猫の動画" }]),
    ];

    expect(titles(filterEntries(entries, "猫"))).toEqual(["猫 まとめ", "猫の動画"]);
    expect(titles(filterEntries(entries, "neon"))).toEqual(["Neon"]);
    expect(titles(filterEntries(entries, "今年"))).toEqual(["犬"]);
    expect(filterEntries(entries, "猫 犬")).toEqual([]);
  });

  it("保存した値を読み戻せる", () => {
    const entries = [entry({ text: "猫" })];

    expect(parseEntries(JSON.stringify(entries))).toEqual(entries);
  });

  it.each([
    ["壊れた JSON", "{"],
    ["形の違う値", '[{"text":1}]'],
    ["配列以外", '"猫"'],
  ])("%s は履歴なしとして扱う", (_, raw) => {
    expect(parseEntries(raw)).toEqual([]);
  });
});
