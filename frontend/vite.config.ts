import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  // amazon-cognito-identity-js が Node 由来の `global` を参照するため、ブラウザでは globalThis に置き換える。
  // 未定義のままだと起動直後に ReferenceError で画面が真っ白になる（テストは Node 上のため検知できない）。
  define: {
    global: "globalThis",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
