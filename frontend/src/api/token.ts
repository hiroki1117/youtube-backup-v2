import { currentSession } from "./cognito";

/** API 呼び出しに付ける Cognito ID トークン。呼び出しごとに取得してよい。 */
export async function getIdToken(): Promise<string | null> {
  const session = await currentSession();
  return session?.getIdToken().getJwtToken() ?? null;
}
