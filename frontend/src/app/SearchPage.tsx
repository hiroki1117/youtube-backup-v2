import { useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SearchHistory } from "@/components/SearchHistory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ViewState } from "@/components/StatusView";
import { VideoCatalog } from "@/components/VideoCatalog";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useVideoSearch, type VideoSearchState } from "@/hooks/useVideoSearch";
import {
  EMPTY_FILTERS,
  hasConditions,
  parseSearchFilters,
  searchTerms,
  toSearchParams,
  type DateRange,
  type SearchFilters,
} from "@/lib/search";
import { entryFilters, filterEntries, type SearchHistoryEntry } from "@/lib/searchHistory";
import type { Video } from "@/types/video";

/**
 * 検索ページ（U3 video-search / US3.1・FR3.1）。条件は URL が持つので、結果から動画を開いて
 * 戻っても同じ結果へ戻れ、再読み込みしても失われない。結果は動画一覧と同じ行で表示する。
 * 語は Enter で確定し（日本語入力の変換中に検索しないため）、日付は選んだ時点で反映する。
 * 履歴は検索欄のすぐ下に出す（スマホではキーボードに隠れない位置）。条件がないときは常に、
 * 結果を表示中は検索欄へフォーカスしたときに表示する。
 */

// 検索状態を一覧の ViewState へ変換する。条件なし・該当なし・入力エラーはこのページが描画する。
function toCatalogState(state: VideoSearchState): ViewState<Video[]> | null {
  switch (state.kind) {
    case "loading":
      return { status: "loading" };
    case "error":
      return { status: "error", message: state.message };
    case "ok":
      return { status: "ready", data: state.videos };
    case "idle":
    case "notFound":
    case "invalidInput":
      return null;
  }
}

function resultCount(state: VideoSearchState): string | null {
  if (state.kind !== "ok") {
    return null;
  }
  return state.hasMore ? `${state.videos.length} 件以上` : `${state.videos.length} 件`;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseSearchFilters(params), [params]);
  const search = useVideoSearch(filters);
  const { state } = search;
  const history = useSearchHistory();
  const { record } = history;
  const inputRef = useRef<HTMLInputElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 操作した検索の条件。戻る・再読み込み・共有リンクで開いた検索は履歴に残さない。
  const pendingRecord = useRef<string | null>(null);

  // 入力中の語。URL 側の変更（戻る等）が来たら追従する。
  const [draft, setDraft] = useState(filters.text);
  const [appliedText, setAppliedText] = useState(filters.text);
  if (filters.text !== appliedText) {
    setAppliedText(filters.text);
    setDraft(filters.text);
  }

  // 検索するために開いたページなので、条件がなければすぐ入力できるようにする。
  const openedEmpty = useRef(!hasConditions(filters));
  useEffect(() => {
    if (openedEmpty.current) {
      inputRef.current?.focus();
    }
  }, []);

  // 結果が確定してから残す。取得中の state は直前の条件の結果を保っている。
  useEffect(() => {
    const settled = !search.isFetching && state.kind !== "error";
    if (!settled || pendingRecord.current !== toSearchParams(filters).toString()) {
      return;
    }
    pendingRecord.current = null;
    if (state.kind === "ok") {
      record(filters, state.videos);
    }
  }, [filters, state, search.isFetching, record]);

  const apply = (next: SearchFilters, replace = false) => {
    pendingRecord.current = toSearchParams(next).toString();
    setParams(toSearchParams(next), { replace });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHistoryOpen(false);
    inputRef.current?.blur();
    apply({ ...filters, text: draft.trim() });
  };

  const handleHistorySelect = (entry: SearchHistoryEntry) => {
    const next = entryFilters(entry, new Date());
    setHistoryOpen(false);
    inputRef.current?.blur();
    setDraft(next.text);
    apply(next);
  };

  // 履歴の行へ Tab で移っても閉じないよう、検索欄と一覧を合わせた範囲のフォーカスを見る。
  const handleSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setHistoryOpen(false);
    }
  };

  const handleClearText = () => {
    setDraft("");
    apply({ ...filters, text: "" });
    inputRef.current?.focus();
  };

  // 日付は操作のたびに履歴を増やさない（「戻る」1 回で動画一覧へ戻れるように）。
  const handleDateChange = (range: DateRange) => apply({ ...filters, ...range }, true);

  const handleReset = () => {
    setDraft("");
    apply(EMPTY_FILTERS);
    inputRef.current?.focus();
  };

  const catalogState = toCatalogState(state);
  const count = resultCount(state);
  const inputError = state.kind === "invalidInput" ? state.message : null;
  // 確定済みの語のままなら一覧を絞らない。結果の表示中でも別の履歴へ移れるように。
  const editing = draft.trim() !== filters.text.trim();
  const historyEntries = editing ? filterEntries(history.entries, draft) : history.entries;
  const showHistory = (state.kind === "idle" || historyOpen) && historyEntries.length > 0;

  return (
    <section aria-label="動画検索" className="space-y-4">
      <h2 className="sr-only">検索</h2>
      <div
        className="space-y-2"
        onFocus={() => setHistoryOpen(true)}
        onBlur={handleSearchBlur}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setHistoryOpen(false);
          }
        }}
      >
        <form role="search" onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={inputRef}
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="タイトル、動画 ID、URL"
              aria-label="検索語"
              aria-invalid={inputError !== null}
              aria-describedby={inputError !== null ? "search-input-error" : undefined}
              enterKeyHint="search"
              className="h-11 pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
              data-search-input
            />
            {draft !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1/2 right-0.5 -translate-y-1/2"
                onClick={handleClearText}
                aria-label="検索語を消す"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
          <Button type="submit" className="h-11">
            検索
          </Button>
        </form>
        {inputError !== null && (
          <p id="search-input-error" role="alert" className="text-sm text-destructive">
            {inputError}
          </p>
        )}
        {showHistory && (
          <SearchHistory
            entries={historyEntries}
            onSelect={handleHistorySelect}
            onRemove={history.remove}
            onClear={editing ? undefined : history.clear}
          />
        )}
      </div>
      <DateRangeFilter from={filters.from} to={filters.to} onChange={handleDateChange} />

      {state.kind === "idle" && history.entries.length === 0 && (
        <div className="space-y-1 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <p>タイトルの一部、動画 ID、動画の URL で探せます。</p>
          <p>空白で区切ると、すべての語を含む動画に絞れます。</p>
          <p>期間だけを選ぶと、その間にバックアップした動画を一覧できます。</p>
        </div>
      )}

      {state.kind === "notFound" && (
        <div role="status" className="space-y-3 rounded-md border p-6 text-center">
          <p className="font-medium">該当する動画はありません</p>
          <p className="text-sm text-muted-foreground">
            語を減らすか、期間を広げてみてください。登録したばかりの動画は、反映に最大 1
            時間かかります。
          </p>
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            条件をクリア
          </Button>
        </div>
      )}

      {count !== null && (
        <div className="text-sm text-muted-foreground">
          <p role="status">
            {count}
            {search.isFetching ? "（更新中）" : ""}
          </p>
          {state.kind === "ok" && state.hasMore && (
            <p>新しい順に表示しています。語を足すか期間を絞ると見つけやすくなります。</p>
          )}
        </div>
      )}

      {catalogState !== null && (
        <div
          aria-busy={search.isFetching}
          className={search.isFetching && state.kind === "ok" ? "opacity-60" : undefined}
        >
          <VideoCatalog
            state={catalogState}
            onRetry={search.refetch}
            loadingLabel="検索しています..."
            listLabel="検索結果"
            searchTerms={searchTerms(filters.text)}
          />
        </div>
      )}

      {state.kind === "ok" && (
        <p className="text-sm text-muted-foreground">登録や変更の反映には最大 1 時間かかります。</p>
      )}
    </section>
  );
}
