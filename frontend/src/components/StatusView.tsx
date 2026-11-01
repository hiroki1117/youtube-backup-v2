import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ViewState } from "@/types/viewState";

/** 読み込み中・失敗・空・表示を、role/aria 付きの共通の見た目で描画する。 */
export interface StatusViewProps<T> {
  state: ViewState<T>;
  onRetry?: () => void;
  children?: (data: T) => ReactNode; // ready 時のレンダラ
  loadingLabel?: string;
}

export function StatusView<T>({ state, onRetry, children, loadingLabel }: StatusViewProps<T>) {
  switch (state.status) {
    case "loading":
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 p-8 text-muted-foreground"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>{loadingLabel ?? "読み込み中..."}</span>
        </div>
      );
    case "error":
      return (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-6 text-center"
        >
          <p className="text-sm text-destructive">{state.message}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              再試行
            </Button>
          ) : null}
        </div>
      );
    case "empty":
      return (
        <div role="status" className="p-8 text-center text-muted-foreground">
          {state.message}
        </div>
      );
    case "ready":
      return <>{children?.(state.data)}</>;
  }
}
