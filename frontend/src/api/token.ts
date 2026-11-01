import { CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js";
import { config } from "./config";

export function userPool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: config.cognito.userPoolId,
    ClientId: config.cognito.clientId,
  });
}

/**
 * API 呼び出しに付ける Cognito ID トークン。未ログイン・期限切れで更新不能なら null。
 * getSession は期限切れなら refresh token で更新するため、呼び出しごとに取得してよい。
 */
export function getIdToken(): Promise<string | null> {
  const currentUser = userPool().getCurrentUser();
  if (!currentUser) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err || !session?.isValid() ? null : session.getIdToken().getJwtToken());
    });
  });
}
