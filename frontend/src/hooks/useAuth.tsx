import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authModule, type AuthApi, type AuthResult, type SessionStatus } from "@/api/auth";

interface AuthContextValue {
  /** 起動時のセッション復元が済むまで `unknown`。 */
  status: "unknown" | SessionStatus;
  signIn: (username: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Storybook とテストは `authApi` にスタブを渡し、Cognito へ到達させない。 */
export function AuthProvider({
  children,
  authApi = authModule,
}: {
  children: ReactNode;
  authApi?: AuthApi;
}) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("unknown");

  useEffect(() => {
    let cancelled = false;
    void authApi.getSession().then((next) => {
      if (!cancelled) {
        setStatus(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authApi]);

  const signIn = async (username: string, password: string) => {
    const result = await authApi.signIn(username, password);
    if (result.kind === "ok") {
      setStatus("authenticated");
    }
    return result;
  };

  const signOut = async () => {
    await authApi.signOut();
    setStatus("unauthenticated");
  };

  return (
    <AuthContext.Provider value={{ status, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth は AuthProvider の内側で使用してください");
  }
  return ctx;
}
