import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVideoRegistration } from "@/hooks/useVideoRegistration";
import { validateVideoUrl } from "@/lib/url";

/**
 * 動画登録ダイアログ（U4 video-registration / US4.1）。
 * URL 入力 → クライアント検証（NFR4）→ 登録フック（useVideoRegistration）へ送信。
 * 補助として「クリップボードから登録」を置き、クリップボードの URL を読んでそのまま送信する
 * （スマホで貼り付け操作を省くため）。読めない・URL でないときは入力欄へ戻して手入力させる。
 * 送信中は送信ボタンを無効化して二重送信を抑止し、登録受理で自動的に閉じる。
 * スマホでは画面下から出るシート、md 以上では中央のダイアログとして表示する（右下の登録ボタンから
 * 開いたとき、親指の届く位置に入力欄が来るように）。
 *
 * 表示専用に近い presentational で、副作用は登録フック（hooks 層）に委譲する。
 * 制御フローは boolean 状態と discriminated union で表現し、表示テキストでは分岐しない。
 */

export interface RegisterDialogProps {
  /** 表示状態。false のときは何も描画しない。 */
  open: boolean;
  /** 閉じる要求（キャンセル・登録受理時）。開閉状態の所有は親（AppShell/app 層）。 */
  onClose: () => void;
}

const CLIPBOARD_UNAVAILABLE = "クリップボードを読み取れませんでした。URL を貼り付けてください。";

export function RegisterDialog({ open, onClose }: RegisterDialogProps) {
  if (!open) {
    return null;
  }
  // 閉じるとフォームごとアンマウントされ、次回はクリーンな入力で開く。
  return <RegisterDialogContent onClose={onClose} />;
}

function RegisterDialogContent({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clipboardRequest = useRef(0);
  // 閉じる・再表示をまたいだ読み取りは、成功・失敗ともに無視する。
  useLayoutEffect(() => {
    return () => {
      clipboardRequest.current += 1;
    };
  }, []);
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  // 登録受理（ok）でダイアログを閉じる。エラー時は開いたまま再入力させる。
  const { submit, isSubmitting } = useVideoRegistration({ onRegistered: onClose });

  // 検証を通れば送信し、通らなければ入力欄に理由を出して直させる（API は呼ばない / NFR4）。
  const submitUrl = (input: string) => {
    const validation = validateVideoUrl(input);
    if (!validation.ok) {
      setValidationError(validation.reason);
      inputRef.current?.focus();
      return;
    }
    setValidationError(null);
    submit(validation.url);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clipboardRequest.current += 1;
    submitUrl(url);
  };

  const handleClose = () => {
    clipboardRequest.current += 1;
    onClose();
  };

  const handlePasteAndRegister = async () => {
    const request = ++clipboardRequest.current;
    let text: string;
    try {
      // 非対応ブラウザ・権限拒否はどちらも手入力へ回す。
      text = await navigator.clipboard.readText();
    } catch {
      if (request !== clipboardRequest.current) return;
      setValidationError(CLIPBOARD_UNAVAILABLE);
      inputRef.current?.focus();
      return;
    }
    if (request !== clipboardRequest.current) return;
    setUrl(text.trim());
    submitUrl(text);
  };

  const hasError = validationError !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-dialog-title"
        className="w-full max-w-md rounded-t-lg border bg-background p-6 shadow-lg md:rounded-lg"
      >
        <h2 id="register-dialog-title" className="text-lg font-semibold">
          動画を登録
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4" aria-label="動画登録フォーム">
          <div className="space-y-2">
            <Label htmlFor="register-url">動画 URL</Label>
            <Input
              ref={inputRef}
              id="register-url"
              type="text"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
              aria-invalid={hasError}
              aria-describedby={hasError ? "register-url-error" : undefined}
            />
            {hasError && (
              <p id="register-url-error" role="alert" className="text-sm text-destructive">
                {validationError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handlePasteAndRegister()}
              disabled={isSubmitting}
            >
              <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
              クリップボードから登録
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
                キャンセル
              </Button>
              <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                登録
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
