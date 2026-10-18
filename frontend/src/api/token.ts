import { CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js";
import { config } from "./config";

/**
 * API 呼び出しに付ける Cognito ID トークン（JWT）を返す。未ログイン・期限切れで更新不能なら null。
 * getSession は有効期限が切れていれば refresh token で自動更新するため、呼び出しごとに取得してよい。
 */
export function getIdToken(): Promise<string | null> {
  const currentUser = new CognitoUserPool({
    UserPoolId: config.cognito.userPoolId,
    ClientId: config.cognito.clientId,
  }).getCurrentUser();
  if (!currentUser) {
    return Promise.resolve(null);
  }
  return new Promise<string | null>((resolve) => {
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
      } else {
        resolve(session.getIdToken().getJwtToken());
      }
    });
  });
}
