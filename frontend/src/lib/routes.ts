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
