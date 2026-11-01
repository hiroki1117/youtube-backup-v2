import { AuthenticationDetails, CognitoUser } from "amazon-cognito-identity-js";
import { currentSession, userPool } from "./cognito";

/** Cognito の USER_SRP_AUTH でログインする（パスワードを平文で送らない）。例外は投げない。 */
export type AuthResult =
  | { kind: "ok" }
  | { kind: "invalidCredentials"; message: string }
  | { kind: "transport"; message: string };

export type SessionStatus = "authenticated" | "unauthenticated";

export interface AuthApi {
  getSession(): Promise<SessionStatus>;
  signIn(username: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}

// 認証情報の誤りとして扱う Cognito エラーコード（それ以外は transport 扱い）。
const CREDENTIAL_ERROR_CODES = new Set([
  "NotAuthorizedException",
  "UserNotFoundException",
  "UserNotConfirmedException",
  "PasswordResetRequiredException",
]);

function readError(err: unknown): { code: string; message: string } {
  const info: { code?: unknown; name?: unknown; message?: unknown } =
    typeof err === "object" && err !== null ? err : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    code: text(info.code) || text(info.name),
    message: typeof info.message === "string" ? info.message : "認証に失敗しました",
  };
}

export const authModule: AuthApi = {
  async getSession() {
    return (await currentSession()) === null ? "unauthenticated" : "authenticated";
  },

  signIn(username, password) {
    const user = new CognitoUser({ Username: username, Pool: userPool() });
    const details = new AuthenticationDetails({ Username: username, Password: password });
    return new Promise((resolve) => {
      user.authenticateUser(details, {
        onSuccess: () => resolve({ kind: "ok" }),
        onFailure: (err: unknown) => {
          const { code, message } = readError(err);
          const kind = CREDENTIAL_ERROR_CODES.has(code) ? "invalidCredentials" : "transport";
          resolve({ kind, message });
        },
        newPasswordRequired: () =>
          resolve({
            kind: "invalidCredentials",
            message: "パスワードの再設定が必要です。管理者に連絡してください。",
          }),
      });
    });
  },

  async signOut() {
    userPool().getCurrentUser()?.signOut();
  },
};
