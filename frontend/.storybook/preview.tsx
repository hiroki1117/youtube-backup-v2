import type { Decorator, Preview } from "@storybook/react-vite";
import { setupWorker } from "msw/browser";
import { mswLoader } from "msw-storybook-addon/csf3";
import type { Theme } from "../src/hooks/useTheme";
import { clearNotifications } from "../src/lib/notify";
import { storybookHandlers } from "../src/test/storybook/msw";
import "../src/index.css";

/**
 * 全 Story 共通のベース設定（US-1 / US-4 / US-8 / US-9 / OQ2 / OQ3 / R-01 最小 Provider 戦略）。
 * ここに置くのは「共通ベース」だけ: CSS トークン読込・テーマ属性切替・MSW 初期化・a11y・notify リセット。
 * Provider（QueryClient / Theme / Auth / Router）は置かない。各 Story が `src/test/storybook/decorators.tsx`
 * の最小デコレータを自分で付与する（全部乗せデコレータは Story の実依存を隠蔽するため採用しない）。
 */

// `useTheme.tsx` の STORAGE_KEY と同じキー（非 export のためここで再定義）。
const THEME_STORAGE_KEY = "theme";

/**
 * テーマ切替デコレータ（US-4）。`src/index.css` の `@custom-variant dark` は `[data-theme="dark"]` セレクタ
 * のため class トグルでは効かず、`<html data-theme>` 属性の切替が必須。
 * `ThemeProvider` は初期化時に localStorage を読み、自身の effect で `data-theme` を上書きするので、
 * localStorage も同期しつつ `key` で Story を再マウントし、Provider 付き Story にも切替を反映する。
 */
const withThemeAttribute: Decorator = (Story, context) => {
  const theme: Theme = context.globals.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage が使えない環境でも属性切替は継続する
  }
  return <Story key={theme} />;
};

/** notify シングルトンの Story 間リーク防止（OQ2）。テスト setup と同じ `clearNotifications()` を使う。 */
const withNotifyReset: Decorator = (Story) => {
  clearNotifications();
  return <Story />;
};

/**
 * MSW worker の起動（OQ3）。既定ハンドラ `src/test/handlers.ts` を再利用し、Story 差分は
 * `parameters.msw.handlers` で上書きする（Story 切替時に初期ハンドラへ自動リセット）。
 * onUnhandledRequest は "error" 相当: 同一 origin（Storybook 自身の資産・HMR）だけバイパスし、
 * それ以外の未モック要求はエラーにして実バックエンドへ到達させない（US-9）。
 */
async function startMockServiceWorker() {
  const worker = setupWorker(...storybookHandlers);
  await worker.start({
    quiet: true,
    // Resolve beside iframe.html, including /<repository>/storybook/ on Pages.
    serviceWorker: { url: new URL("./mockServiceWorker.js", window.location.href).href },
    onUnhandledRequest(request, print) {
      if (new URL(request.url).origin === window.location.origin) {
        return;
      }
      print.error();
    },
  });
  return worker;
}

const preview: Preview = {
  loaders: [mswLoader(startMockServiceWorker)],
  // 後ろの要素が外側に適用される。テーマは最外側で `key` 再マウントを全体に効かせる。
  decorators: [withNotifyReset, withThemeAttribute],
  globalTypes: {
    theme: {
      description: "テーマ（<html data-theme> 属性で切替）",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    // a11y は警告レベル（US-8）。Storybook UI パネル上の開発時シグナルであり CI ゲートではない。
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
