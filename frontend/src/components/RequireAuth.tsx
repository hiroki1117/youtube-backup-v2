import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { StatusView } from "@/components/StatusView";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "unknown") {
    return <StatusView state={{ status: "loading" }} loadingLabel="認証状態を確認しています..." />;
  }

  if (status === "unauthenticated") {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
