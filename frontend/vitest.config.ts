import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vitest 設定。unit-test-instructions.md 準拠:
// jsdom 環境、RTL + MSW の setupFiles、@vitest/coverage-v8 で line 80% floor、
// non-testable boilerplate（main.tsx / vite.config.* / *.d.ts / src/**/index.ts）を除外。
// Story（src/**/*.stories.{ts,tsx}）は Vitest で実行されないため coverage の分母から除外する
// （floor の緩和ではなく測定範囲の正常化）。Storybook 専用ヘルパは src/test/** に置き既存除外で分母外。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    // Node 26 の Web Storage が jsdom の localStorage を隠さないようにする。
    // テストでは Node のファイル保存用 Storage ではなく、jsdom のブラウザ実装を使う。
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // テスト時の VITE_* は placeholder（真の機密ではない構成値）。
    env: {
      VITE_API_BASE_URL: "https://api.test.invalid",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_examplepool",
      VITE_COGNITO_CLIENT_ID: "testclientid0000000000",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.{ts,tsx}",
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
