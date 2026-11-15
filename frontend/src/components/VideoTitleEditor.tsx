import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Enter で保存、Esc で破棄。未変更・空白のみ・保存中は保存できない。 */

const TITLE_MAX_LENGTH = 1000;

export interface VideoTitleEditorProps {
  title: string;
  isSaving: boolean;
  /** 前後の空白を除いたタイトルを渡す。 */
  onSave: (title: string) => void;
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
      onSave(trimmed);
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
        className="min-w-0 basis-full sm:flex-1"
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
