import { useCallback, useState } from "react";
import type { SearchFilters } from "@/lib/search";
import {
  addEntry,
  createEntry,
  parseEntries,
  removeEntry,
  type SearchHistoryEntry,
} from "@/lib/searchHistory";
import type { Video } from "@/types/video";

/**
 * 検索履歴フック（U3 video-search）。履歴はこのブラウザの localStorage にだけ保存する。
 * 別タブの変更を上書きしないよう、更新のたびに保存値を読み直す。
 */

const STORAGE_KEY = "searchHistory";

function readEntries(): SearchHistoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? [] : parseEntries(stored);
  } catch {
    // localStorage 参照不能時は履歴なしとして扱う
    return [];
  }
}

function writeEntries(entries: SearchHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 永続化不能でも検索は継続する
  }
}

/** ログアウト時に呼ぶ。検索語を次にこのブラウザを使う人へ残さない。 */
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage 参照不能時は消すものがない
  }
}

export interface SearchHistoryController {
  /** 新しい順の履歴。 */
  entries: SearchHistoryEntry[];
  /** 結果の出た検索を残す。 */
  record: (filters: SearchFilters, videos: Video[]) => void;
  remove: (entry: SearchHistoryEntry) => void;
  clear: () => void;
}

export function useSearchHistory(): SearchHistoryController {
  const [entries, setEntries] = useState(readEntries);

  const update = useCallback((change: (current: SearchHistoryEntry[]) => SearchHistoryEntry[]) => {
    const next = change(readEntries());
    writeEntries(next);
    setEntries(next);
  }, []);

  const record = useCallback(
    (filters: SearchFilters, videos: Video[]) => {
      update((current) => addEntry(current, createEntry(filters, videos, new Date())));
    },
    [update],
  );

  const remove = useCallback(
    (entry: SearchHistoryEntry) => update((current) => removeEntry(current, entry)),
    [update],
  );

  const clear = useCallback(() => {
    clearSearchHistory();
    setEntries([]);
  }, []);

  return { entries, record, remove, clear };
}
