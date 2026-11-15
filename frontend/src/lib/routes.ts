export const ROUTES = {
  login: "/login",
  videos: "/videos",
  search: "/search",
  videoDetail: "/videos/:videoId",
} as const;

/** 検索結果から再生ページへ渡す location.state。戻り先の検索結果を指す。 */
export interface SearchReturnState {
  searchReturnTo: string;
}

/** location.state から戻り先の検索結果を取り出す。検索結果から来ていなければ null。 */
export function resolveSearchReturn(state: unknown): string | null {
  if (
    state !== null &&
    typeof state === "object" &&
    "searchReturnTo" in state &&
    typeof state.searchReturnTo === "string"
  ) {
    return state.searchReturnTo;
  }
  return null;
}
