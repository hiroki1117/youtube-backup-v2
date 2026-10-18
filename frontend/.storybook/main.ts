import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";
import { mergeConfig, type AliasOptions } from "vite";

/**
 * Storybook 本体設定（US-1 / US-5 / US-9 / OQ1）。
 * - Story はコンポーネントとコロケーションした `src/**\/*.stories.tsx`（basename ミラー命名）。
 * - a11y アドオン（警告レベル。CI ゲートではない）。essentials 相当は v9 以降コアに統合済み。
 * - MSW の worker は `.storybook/public/` から配信する（ルート `public/` に置くと `vite build` が
 *   `dist/` へ複製し本番 S3 へ配信されてしまうため）。
 * - `viteFinal` の `define` で `import.meta.env.VITE_*` を設定ファイル側で固定する。シェル環境や
 *   `.env` に実値があっても Storybook バンドルには入らない（NFR1）。値は `vitest.config.ts` の
 *   `test.env` と同一のダミーで、`src/test/handlers.ts` の `TEST_API_BASE` と一致させる。
 */
const STORYBOOK_ENV = {
  VITE_API_BASE_URL: "https://api.test.invalid",
  VITE_COGNITO_USER_POOL_ID: "us-east-1_examplepool",
  VITE_COGNITO_CLIENT_ID: "testclientid0000000000",
  VITE_COGNITO_REGION: "us-east-1",
} as const satisfies Record<`VITE_${string}`, string>;

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  staticDirs: ["./public"],
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => {
    const merged = mergeConfig(viteConfig, {
      define: Object.fromEntries(
        Object.entries(STORYBOOK_ENV).map(([key, value]) => [
          `import.meta.env.${key}`,
          JSON.stringify(value),
        ]),
      ),
    });
    // API クライアントのトークン取得を固定値のスタブへ差し替える（Cognito へ接続しない）。
    // 既存の `@` エイリアスより前に置かないと、先に `@` が一致してしまう。
    const existing: AliasOptions = merged.resolve?.alias ?? [];
    const aliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));
    merged.resolve = {
      ...merged.resolve,
      alias: [
        {
          find: /^@\/api\/token$/,
          replacement: fileURLToPath(new URL("../src/test/storybook/token.ts", import.meta.url)),
        },
        ...aliases,
      ],
    };
    return merged;
  },
};

export default config;
