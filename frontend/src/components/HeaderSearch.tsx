import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_FILTERS, toSearchParams } from "@/lib/search";
import { ROUTES } from "@/lib/routes";

/**
 * ヘッダの検索入口（U3 / C5）。どの画面からも検索ページへ移る。広い画面はその場で入力でき、
 * 狭い画面はヘッダが 1 行に収まるようアイコンから検索ページを開く。検索ページには専用の
 * 検索欄があるので、そこでは表示しない。`/` キーで検索欄へ移れる。
 */

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function HeaderSearch() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [text, setText] = useState("");

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      // 検索ページの検索欄と、広い画面のヘッダの検索欄のうち、画面に出ているほうへ移る。
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-search-input]");
      const visible = [...inputs].find((input) => input.offsetParent !== null);
      if (visible) {
        visible.focus();
        visible.select();
      } else {
        navigate(ROUTES.search);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [navigate]);

  if (pathname === ROUTES.search) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = toSearchParams({ ...EMPTY_FILTERS, text: text.trim() }).toString();
    setText("");
    navigate({ pathname: ROUTES.search, search: params });
  };

  return (
    <>
      <form
        role="search"
        onSubmit={handleSubmit}
        className="relative hidden w-full max-w-sm sm:block"
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="動画を検索"
          aria-label="動画を検索"
          enterKeyHint="search"
          className="h-9 pl-9 pointer-fine:pr-8"
          data-search-input
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border px-1.5 text-xs text-muted-foreground pointer-fine:block">
          /
        </kbd>
      </form>
      <Button asChild variant="ghost" size="icon" className="sm:hidden">
        <Link to={ROUTES.search} aria-label="検索ページを開く">
          <Search className="size-5" aria-hidden="true" />
        </Link>
      </Button>
    </>
  );
}
