import { useState } from "react";
import { LogOut, Plus } from "lucide-react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RegisterDialog } from "@/components/RegisterDialog";
import { HeaderSearch } from "@/components/HeaderSearch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

/**
 * 共通レイアウト（contract C5 AppShell）。ヘッダ（検索/テーマ/ログアウトのアクション起点）+ Outlet
 * + 右下の登録ボタン。
 * 検索（U3）はヘッダから検索ページへ移る。登録アクション（C5 openRegister / U4）はどの画面でも
 * 右下の丸いボタン（スマホで親指の届く位置）からダイアログを開く。
 * ログアウトは signOut → TanStack Query キャッシュクリア → /login（WF2 / NFR4.6）。
 */
export function AppShell() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [registerOpen, setRegisterOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    queryClient.clear();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <div className="min-h-dvh">
      {/* スマホでは長い一覧をスクロールしても検索へ移れるよう、ヘッダを上部に固定する。 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background px-4 py-3 md:static">
        <h1 className="min-w-0 truncate text-lg font-semibold">
          <Link to={ROUTES.videos} className="-my-2 inline-block py-2">
            youtube-backup
          </Link>
        </h1>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <HeaderSearch />
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="ログアウト">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>
      {/* 右下の登録ボタンが最後の行に重ならないよう下に余白を取る。 */}
      <main className="mx-auto max-w-5xl p-4 pb-24">
        <Outlet />
      </main>
      <Button
        onClick={() => setRegisterOpen(true)}
        aria-label="動画を登録"
        className="fixed right-4 bottom-4 z-40 size-14 rounded-full shadow-lg md:right-8 md:bottom-8"
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>
      <RegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  );
}
