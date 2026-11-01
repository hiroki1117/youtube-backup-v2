import { useMemo, useState, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import type { SessionStatus } from "@/api/auth";
import { routes } from "@/app/routes";
import { Toaster } from "@/components/Toaster";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { createStubAuthApi, type StubAuthApiOptions } from "./auth";

/**
 * Storybook 用の最小 Provider デコレータ（R-01 最小 Provider 戦略 / R-03 配置 / US-1 / US-3）。
 * 各 Story は自分の実依存に対応するデコレータだけを付与する:
 * - `Toaster`: Provider 不要 / `ThemeToggle`: withTheme / `RegisterDialog`: withQueryClient /
 * - `HeaderSearch`: withMemoryRouter / ページ: withAppRoutes（Query + Theme + Auth + Router）。
 * `src/test/**` はレイヤグラフ外のため、ここから `@/app/routes` や `@/hooks/*` を import してよい。
 */

/** Story が `parameters.auth` / `parameters.router` で渡す設定の型（module augmentation）。 */
declare module "storybook/internal/csf" {
  interface Parameters {
    /**
     * Auth スタブの状態。`"authenticated"` / `"unauthenticated"` の短縮形か、
     * `signInResult` を伴うオブジェクト形（LoginPage/SubmitError 等）。未指定は unauthenticated。
     */
    auth?: SessionStatus | StubAuthApiOptions;
    /** memory router の初期エントリ（withMemoryRouter / withAppRoutes が読む）。未指定は `["/"]`。 */
    router?: {
      initialEntries?: string[];
    };
  }
}

const DEFAULT_AUTH: StubAuthApiOptions = { status: "unauthenticated" };
const DEFAULT_INITIAL_ENTRIES = ["/"];

function resolveAuthOptions(
  auth: SessionStatus | StubAuthApiOptions | undefined,
): StubAuthApiOptions {
  if (auth === undefined) {
    return DEFAULT_AUTH;
  }
  return typeof auth === "string" ? { status: auth } : auth;
}

function resolveInitialEntries(router: { initialEntries?: string[] } | undefined): string[] {
  return router?.initialEntries ?? DEFAULT_INITIAL_ENTRIES;
}

/** Story のマウントごとに新規の QueryClient を持つ（retry なし。Story 間でキャッシュを共有しない）。 */
function FreshQueryClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * `parameters.auth` から生成した AuthApi スタブを AuthProvider に注入する。
 * `resolveAuthOptions` は文字列形式の `parameters.auth` を render ごとに新しいオブジェクトへ変換するため、
 * オブジェクト参照ではなく値（`status` と `signInResult`）で memo 化し、`AuthProvider` の
 * `useCallback` → `useEffect` が余分に発火して `getSession()` が再呼び出しされるのを防ぐ（レビュー R-02）。
 * `signInResult` は Story の `parameters` に定義された参照が安定しているため依存に含めてよい。
 */
function StubAuthProvider({ auth, children }: { auth: StubAuthApiOptions; children: ReactNode }) {
  const { status, signInResult } = auth;
  const authApi = useMemo(
    () => createStubAuthApi({ status, signInResult }),
    [status, signInResult],
  );
  return <AuthProvider authApi={authApi}>{children}</AuthProvider>;
}

/**
 * 実ルート定義（`RequireAuth → AppShell → ページ`）を memory router で描画する。
 * router はマウントごとに 1 回だけ生成する。
 */
function AppRoutesHarness({ initialEntries }: { initialEntries: string[] }) {
  const [router] = useState(() => createMemoryRouter(routes, { initialEntries }));
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}

/** TanStack Query の Provider（RegisterDialog / SearchDialog 等の hooks 依存コンポーネント用）。 */
export const withQueryClient: Decorator = (Story) => (
  <FreshQueryClientProvider>
    <Story />
  </FreshQueryClientProvider>
);

/** ThemeProvider のみ（ThemeToggle 用）。 */
export const withTheme: Decorator = (Story) => (
  <ThemeProvider>
    <Story />
  </ThemeProvider>
);

/** `parameters.auth` に従う AuthProvider（スタブ注入）。 */
export const withAuth: Decorator = (Story, context) => (
  <StubAuthProvider auth={resolveAuthOptions(context.parameters.auth)}>
    <Story />
  </StubAuthProvider>
);

/** MemoryRouter のみ（`useNavigate` を使うダイアログ用。`parameters.router.initialEntries` を読む）。 */
export const withMemoryRouter: Decorator = (Story, context) => (
  <MemoryRouter initialEntries={resolveInitialEntries(context.parameters.router)}>
    <Story />
  </MemoryRouter>
);

/**
 * ページ Story 用。Query + Theme + Auth(stub) + memory router（実ルート定義）+ Toaster を合成する。
 * ページは `parameters.router.initialEntries` で指定した URL のルートとして描画されるため、
 * Story 自身の描画結果（`Story`）は使わない。
 */
export const withAppRoutes: Decorator = (_Story, context) => (
  <FreshQueryClientProvider>
    <ThemeProvider>
      <StubAuthProvider auth={resolveAuthOptions(context.parameters.auth)}>
        <AppRoutesHarness initialEntries={resolveInitialEntries(context.parameters.router)} />
      </StubAuthProvider>
    </ThemeProvider>
  </FreshQueryClientProvider>
);
