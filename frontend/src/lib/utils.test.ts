import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("クラスを結合する", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("falsy を除外し、Tailwind の衝突を後勝ちで解決する", () => {
    expect(cn("p-2", false, undefined, "p-4")).toBe("p-4");
  });
});
