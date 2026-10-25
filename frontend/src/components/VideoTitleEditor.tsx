import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 動画タイトルのインライン編集フォーム（presentational）。
 * 入力は親が渡した `title` で初期化し、Enter / 「保存」で `onSave(trimmed)`、Esc / 「キャンセル」で
 * `onCancel` を呼ぶ。未変更・空白のみ・保存中は保存できない。副作用・API 依存を持たない。
 * `onSave` が false を返したとき（失敗）は編集状態のまま入力内容を保持する。
 */

export const TITLE_MAX_LENGTH = 1000;

export interface VideoTitleEditorProps {
  /** 現在のタイトル（入力の初期値）。 */
  title: string;
  /** 保存実行中。入力とボタンを無効化する。 */
  isSaving: boolean;
  /** 保存。前後の空白を除いたタイトルを渡す。成功なら true を解決する。 */
  onSave: (title: string) => Promise<boolean> | boolean;
  /** 編集を破棄して閉じる。 */
  onCancel: () => void;
}

export function VideoTitleEditor({ title, isSaving, onSave, onCancel }: VideoTitleEditorProps) {
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const canSave = !isSaving && trimmed.length > 0 && trimmed !== title;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSave) {
      void onSave(trimmed);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && !isSaving) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2"
      aria-label="タイトルを編集"
      data-testid="title-editor"
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={TITLE_MAX_LENGTH}
        disabled={isSaving}
        aria-label="タイトル"
        className="min-w-0 flex-1"
        data-testid="title-input"
      />
      <Button type="submit" size="sm" disabled={!canSave} data-testid="title-save-button">
        {isSaving ? "保存中..." : "保存"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
        キャンセル
      </Button>
    </form>
  );
}
