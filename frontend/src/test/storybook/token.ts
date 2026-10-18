/**
 * Storybook 用のトークン取得スタブ（`.storybook/main.ts` が `@/api/token` をこのファイルへ差し替える）。
 * Storybook は Cognito へ接続せず、API は MSW で応答するため、固定のダミー値を返す（実トークンではない）。
 */
export function getIdToken(): Promise<string | null> {
  return Promise.resolve("storybook-token");
}
