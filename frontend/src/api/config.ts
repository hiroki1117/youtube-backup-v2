/** VITE_* から注入する公開前提の構成値。真の機密はフロントに置かない。 */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  cognito: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
  },
};
