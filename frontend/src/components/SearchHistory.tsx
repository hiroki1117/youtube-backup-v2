import { useRef, useState, type MouseEvent } from "react";
import { CalendarDays, Search, Video, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeEntry,
  entryKey,
  type SearchHistoryEntry,
  type SearchHistoryKind,
} from "@/lib/searchHistory";

/**
 * 検索履歴の一覧（presentational / U3）。行を押すとその検索をやり直す。
 * 個別の削除はすぐに行い、まとめて消すときだけもう一度押してもらう。
 */

export interface SearchHistoryProps {
  entries: SearchHistoryEntry[];
  onSelect: (entry: SearchHistoryEntry) => void;
  onRemove: (entry: SearchHistoryEntry) => void;
  /** 省略すると「すべて削除」を出さない（絞り込み中は一覧と削除の範囲が食い違うため）。 */
  onClear?: () => void;
}

const KIND_ICON: Record<SearchHistoryKind, LucideIcon> = {
  text: Search,
  date: CalendarDays,
  video: Video,
};

// 検索欄からフォーカスを奪わない。奪うと押した瞬間に一覧が閉じ、押下が行に届かない。
function keepInputFocus(event: MouseEvent) {
  event.preventDefault();
}

export function SearchHistory({ entries, onSelect, onRemove, onClear }: SearchHistoryProps) {
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const handleRemove = (event: MouseEvent<HTMLButtonElement>, entry: SearchHistoryEntry) => {
    // キーボード操作では押したボタンごと消えるので、フォーカスを一覧に残す。
    if (event.currentTarget === document.activeElement) {
      listRef.current?.focus();
    }
    onRemove(entry);
  };

  const handleClear = () => {
    if (confirming) {
      setConfirming(false);
      onClear?.();
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="rounded-md border" onMouseDown={keepInputFocus}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b px-3 py-1">
        <h3 className="text-xs text-muted-foreground">最近の検索</h3>
        {onClear !== undefined && (
          <div className="flex gap-1">
            {confirming && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                やめる
              </Button>
            )}
            <Button
              type="button"
              variant={confirming ? "destructive" : "ghost"}
              size="sm"
              onClick={handleClear}
            >
              {confirming ? "本当に削除" : "すべて削除"}
            </Button>
          </div>
        )}
      </div>
      <ul
        ref={listRef}
        aria-label="検索履歴"
        tabIndex={-1}
        className="max-h-72 divide-y overflow-y-auto focus:outline-hidden"
      >
        {entries.map((entry) => {
          const { kind, title, detail } = describeEntry(entry);
          const Icon = KIND_ICON[kind];
          const label = detail === null ? title : `${title}、${detail}`;
          return (
            <li key={entryKey(entry)} className="flex items-center">
              <button
                type="button"
                aria-label={`${label} を検索`}
                onClick={() => onSelect(entry)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-1.5 text-left hover:bg-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{title}</span>
                  {detail !== null && (
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  )}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                aria-label={`${title} を履歴から削除`}
                onClick={(event) => handleRemove(event, entry)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
