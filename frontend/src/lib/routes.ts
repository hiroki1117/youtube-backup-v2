/**
 * ルート定義（contract C5 AppShell ルーティング契約）。
 * ライブラリ非依存の定数として固定し、コンポーネント層・アプリ層の双方が参照する
 * （レイヤ逆流を避けるため leaf である lib に配置）。
 */
export const ROUTES = {
  login: "/login",
  videos: "/videos",
  search: "/search",
  videoDetail: "/videos/:videoId",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

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
