import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlaylistRegistration } from "@/components/PlaylistRegistration";
import { usePlaylistRegistration } from "@/hooks/usePlaylistRegistration";
import { useVideoRegistration } from "@/hooks/useVideoRegistration";
import { isYoutubePlaylistUrl, validateVideoUrl } from "@/lib/url";

/**
 * URL を入力するか、クリップボードから読んでそのまま送信する（スマホで貼り付け操作を省くため）。
 * タッチ操作ではキーボードがシートを隠さないよう、入力欄へ自動でフォーカスしない。
 *
 * 再生リストのページの URL は中身を読み込み、本数とタイトルを確認してから一括登録する
 * （クリップボードからでも確認の前で止まる）。`watch?v=…&list=…` は動画 1 本として登録する。
 */

export interface RegisterDialogProps {
  open: boolean;
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
  const [isTouch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const clipboardRequest = useRef(0);
  // 閉じる・再表示をまたいだ読み取りは、成功・失敗ともに無視する。
  useLayoutEffect(() => {
    return () => {
      clipboardRequest.current += 1;
    };
  }, []);
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { submit, isSubmitting } = useVideoRegistration({ onRegistered: onClose });
  const playlist = usePlaylistRegistration();
  const isBusy = isSubmitting || playlist.state.step === "loading";

  const showError = (message: string) => {
    setValidationError(message);
    inputRef.current?.focus();
  };

  const loadPlaylist = async (playlistUrl: string) => {
    const error = await playlist.load(playlistUrl);
    if (error !== null) {
      showError(error);
    }
  };

  const submitUrl = (input: string) => {
    const validation = validateVideoUrl(input);
    if (!validation.ok) {
      showError(validation.reason);
      return;
    }
    setValidationError(null);
    if (isYoutubePlaylistUrl(validation.url)) {
      void loadPlaylist(validation.url);
      return;
    }
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
      showError(CLIPBOARD_UNAVAILABLE);
      return;
    }
    if (request !== clipboardRequest.current) return;
    setUrl(text.trim());
    submitUrl(text);
  };

  const hasError = validationError !== null;
  const { state } = playlist;
  const playlistStep =
    state.step === "preview" || state.step === "registering" || state.step === "finished"
      ? state
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-dialog-title"
        className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-t-lg border bg-background p-6 shadow-lg md:rounded-lg"
      >
        <h2 id="register-dialog-title" className="text-lg font-semibold">
          {playlistStep ? "再生リストを登録" : "動画を登録"}
        </h2>
        {playlistStep ? (
          <PlaylistRegistration
            state={playlistStep}
            onRegister={playlist.register}
            onStop={playlist.stop}
            onBack={playlist.reset}
            onClose={handleClose}
          />
        ) : (
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
                enterKeyHint="go"
                autoFocus={!isTouch}
                aria-invalid={hasError}
                aria-describedby={hasError ? "register-url-error" : undefined}
              />
              {hasError && (
                <p id="register-url-error" role="alert" className="text-sm text-destructive">
                  {validationError}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between">
              <Button
                type="button"
                variant={isTouch ? "default" : "outline"}
                onClick={() => void handlePasteAndRegister()}
                disabled={isBusy}
              >
                <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
                クリップボードから登録
              </Button>
              <div className="grid grid-cols-2 gap-2 md:ml-auto md:flex">
                <Button type="button" variant="ghost" onClick={handleClose} disabled={isBusy}>
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  variant={isTouch ? "outline" : "default"}
                  disabled={isBusy}
                  aria-busy={isBusy}
                >
                  {state.step === "loading" ? "読み込み中…" : "登録"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
