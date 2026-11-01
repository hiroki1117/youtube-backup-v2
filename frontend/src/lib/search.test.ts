import { describe, expect, it } from "vitest";
import {
  hasConditions,
  highlightParts,
  isCompleteDate,
  matchPreset,
  normalizeRange,
  parseSearchFilters,
  presetRange,
  searchTerms,
  toSearchParams,
} from "./search";

const TODAY = new Date(2026, 10, 1); // 2026-11-01

describe("URL の検索条件", () => {
  it("条件と URL を往復できる", () => {
    const filters = { text: "猫 まとめ", from: "2026-08-01", to: "2026-08-31" };
    expect(parseSearchFilters(toSearchParams(filters))).toEqual(filters);
  });

  it("未指定の条件は URL に出さない", () => {
    expect(toSearchParams({ text: "猫", from: "", to: "" }).toString()).toBe("q=%E7%8C%AB");
  });

  it("不正な日付は無視し、逆の範囲は入れ替える", () => {
    expect(parseSearchFilters(new URLSearchParams("from=yesterday&to=0002-01-01"))).toEqual({
      text: "",
      from: "",
      to: "",
    });
    expect(parseSearchFilters(new URLSearchParams("from=2026-02-02&to=2026-02-01"))).toEqual({
      text: "",
      from: "2026-02-01",
      to: "2026-02-02",
    });
  });

  it("空白だけの語は条件に数えない", () => {
    expect(hasConditions({ text: "   ", from: "", to: "" })).toBe(false);
    expect(hasConditions({ text: "", from: "2026-01-01", to: "" })).toBe(true);
  });
});

describe("期間", () => {
  it("入力途中の年は確定した日付として扱わない", () => {
    expect(isCompleteDate("0002-01-01")).toBe(false);
    expect(isCompleteDate("2026-01-01")).toBe(true);
  });

  it("片側だけの範囲は入れ替えない", () => {
    expect(normalizeRange({ from: "2026-02-02", to: "" })).toEqual({
      from: "2026-02-02",
      to: "",
    });
  });

  it.each([
    ["all", { from: "", to: "" }],
    ["week", { from: "2026-10-26", to: "2026-11-01" }],
    ["month", { from: "2026-10-03", to: "2026-11-01" }],
    ["thisYear", { from: "2026-01-01", to: "2026-11-01" }],
    ["lastYear", { from: "2025-01-01", to: "2025-12-31" }],
  ] as const)("%s の範囲を求め、逆に範囲からも判定できる", (preset, range) => {
    expect(presetRange(preset, TODAY)).toEqual(range);
    expect(matchPreset(range, TODAY)).toBe(preset);
  });

  it("月をまたいでも暦どおりに数える", () => {
    expect(presetRange("week", new Date(2026, 2, 3)).from).toBe("2026-02-25");
  });

  it("手で指定した範囲はプリセットに一致しない", () => {
    expect(matchPreset({ from: "2026-08-01", to: "2026-08-31" }, TODAY)).toBeNull();
  });
});

describe("検索語のハイライト", () => {
  it("URL はタイトルと照合しない", () => {
    expect(searchTerms("https://youtu.be/abc")).toEqual([]);
  });

  it("全角空白でも語を分ける", () => {
    expect(searchTerms(" 猫　まとめ ")).toEqual(["猫", "まとめ"]);
  });

  it("一致部分を大文字小文字を区別せずに分ける", () => {
    expect(highlightParts("Neon で検索", ["neon"])).toEqual([
      { text: "Neon", match: true },
      { text: " で検索", match: false },
    ]);
  });

  it("重なる語は長いほうを優先し、記号は文字として扱う", () => {
    expect(highlightParts("猫動画 (c++)", ["猫", "猫動画", "c++"])).toEqual([
      { text: "猫動画", match: true },
      { text: " (", match: false },
      { text: "c++", match: true },
      { text: ")", match: false },
    ]);
  });

  it("語がなければ全体をそのまま返す", () => {
    expect(highlightParts("猫", [])).toEqual([{ text: "猫", match: false }]);
  });
});
