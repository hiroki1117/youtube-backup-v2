import { useEffect } from "react";
import { Search } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/routes";

/**
 * 検索ページへのリンク（広い画面は検索欄の見た目、狭い画面はアイコン）と `/` キーの入口。
 * 検索ページには専用の検索欄があるので、そこでは表示しない。
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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("[data-search-input]");
      if (input) {
        input.focus();
        input.select();
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

  return (
    <Link
      to={ROUTES.search}
      aria-label="動画を検索"
      className="flex size-10 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground ring-offset-background hover:bg-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-9 sm:pointer-coarse:h-10 sm:w-full sm:max-w-sm sm:justify-start sm:border sm:border-input sm:bg-background sm:px-3"
    >
      <Search
        className="size-5 text-foreground sm:size-4 sm:text-muted-foreground"
        aria-hidden="true"
      />
      <span className="hidden sm:inline">動画を検索</span>
      <kbd className="ml-auto hidden rounded border px-1.5 text-xs sm:pointer-fine:block">/</kbd>
    </Link>
  );
}
