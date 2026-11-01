import { Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LoginPage } from "@/app/LoginPage";
import { SearchPage } from "@/app/SearchPage";
import { VideosPage } from "@/app/VideosPage";
import { VideoPlaybackPage } from "@/app/VideoPlaybackPage";
import { ROUTES } from "@/lib/routes";

/**
 * ルート定義（contract C5）。browser router（main.tsx）と memory router（テスト）で共有する。
 * 保護ルートは RequireAuth → AppShell（Outlet）配下に構成する。
 */
export const routes: RouteObject[] = [
  { path: ROUTES.login, element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={ROUTES.videos} replace /> },
      { path: "videos", element: <VideosPage /> },
      { path: "search", element: <SearchPage /> },
      // 詳細・再生ページ（C5 ROUTES.videoDetail = /videos/:videoId / U6 video-playback）。
      { path: "videos/:videoId", element: <VideoPlaybackPage /> },
    ],
  },
  { path: "*", element: <Navigate to={ROUTES.videos} replace /> },
];
