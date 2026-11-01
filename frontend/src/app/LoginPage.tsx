import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/notify";
import { ROUTES } from "@/lib/routes";

const redirectSchema = z.object({ from: z.object({ pathname: z.string() }) });

function resolveRedirect(state: unknown): string {
  const parsed = redirectSchema.safeParse(state);
  return parsed.success ? parsed.data.from.pathname : ROUTES.videos;
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (username.trim() === "" || password === "") {
      setError("ユーザー名とパスワードを入力してください");
      return;
    }
    setSubmitting(true);
    const result = await signIn(username, password);
    setSubmitting(false);
    if (result.kind === "ok") {
      navigate(resolveRedirect(location.state), { replace: true });
      return;
    }
    notify("error", result.message);
    setError(result.message);
    setPassword("");
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        aria-label="ログインフォーム"
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-xs"
      >
        <h1 className="text-center text-xl font-semibold">youtube-backup にログイン</h1>
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="username">ユーザー名</Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">パスワード</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "ログイン中..." : "ログイン"}
        </Button>
      </form>
    </div>
  );
}
