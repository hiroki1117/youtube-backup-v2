import { CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js";
import { config } from "./config";

export function userPool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: config.cognito.userPoolId,
    ClientId: config.cognito.clientId,
  });
}

/** 有効なセッション。未ログイン・期限切れで更新不能なら null。期限切れは refresh token で更新される。 */
export function currentSession(): Promise<CognitoUserSession | null> {
  const currentUser = userPool().getCurrentUser();
  if (!currentUser) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err || !session?.isValid() ? null : session);
    });
  });
}
