import { useState, type ChangeEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DATE_PRESETS,
  isCompleteDate,
  matchPreset,
  normalizeRange,
  presetRange,
  type DatePreset,
  type DateRange,
} from "@/lib/search";

/**
 * バックアップ日の絞り込み（presentational / U3）。よく使う範囲はチップ 1 回で選べるようにし、
 * 日付の手入力は「期間を指定」を開いたときだけ出す。選択は確定ボタンなしで親へ通知する。
 */

export interface DateRangeFilterProps extends DateRange {
  onChange: (range: DateRange) => void;
  /** 基準日（テストと Story で固定する）。 */
  today?: Date;
}

const CHIP_CLASS = "rounded-full px-2.5 sm:px-3";

// クリックした位置によらず日付の選択画面を開く（対応ブラウザのみ。手入力もそのまま使える）。
function openPicker(event: MouseEvent<HTMLInputElement>) {
  try {
    event.currentTarget.showPicker();
  } catch {
    // 非対応のブラウザや、ユーザー操作として扱われない場合は通常の入力に任せる。
  }
}

export function DateRangeFilter({ from, to, onChange, today = new Date() }: DateRangeFilterProps) {
  const preset = matchPreset({ from, to }, today);
  const [customOpen, setCustomOpen] = useState(preset === null);
  // 入力途中の値は親へ渡さず、ここで保つ。URL 側の変更（戻る等）が来たら追従する。
  const [draft, setDraft] = useState({ from, to });
  const [applied, setApplied] = useState({ from, to });
  if (from !== applied.from || to !== applied.to) {
    setApplied({ from, to });
    setDraft({ from, to });
    // 履歴から開いた範囲がチップにないときは、どの期間か分かるよう入力欄を開く。
    if (preset === null) {
      setCustomOpen(true);
    }
  }

  const choosePreset = (id: DatePreset) => {
    setCustomOpen(false);
    onChange(presetRange(id, today));
  };

  const handleDate = (name: keyof DateRange) => (event: ChangeEvent<HTMLInputElement>) => {
    const next = { ...draft, [name]: event.target.value };
    setDraft(next);
    if (next[name] === "" || isCompleteDate(next[name])) {
      onChange(normalizeRange(next));
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p id="search-date-label" className="text-xs text-muted-foreground">
          バックアップ日
        </p>
        <div role="group" aria-labelledby="search-date-label" className="flex flex-wrap gap-1.5">
          {DATE_PRESETS.map(({ id, label, short }) => {
            const selected = !customOpen && preset === id;
            return (
              <Button
                key={id}
                type="button"
                variant={selected ? "default" : "outline"}
                size="sm"
                className={CHIP_CLASS}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => choosePreset(id)}
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Button>
            );
          })}
          <Button
            type="button"
            variant={customOpen ? "default" : "outline"}
            size="sm"
            className={CHIP_CLASS}
            aria-label="期間を指定"
            aria-expanded={customOpen}
            aria-controls="search-date-range"
            onClick={() => setCustomOpen((open) => !open)}
          >
            <span className="sm:hidden">指定</span>
            <span className="hidden sm:inline">期間を指定</span>
          </Button>
        </div>
      </div>
      {customOpen && (
        <div id="search-date-range" className="grid max-w-md gap-2 min-[360px]:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="search-date-from">開始日</Label>
            <Input
              id="search-date-from"
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={handleDate("from")}
              onClick={openPicker}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="search-date-to">終了日</Label>
            <Input
              id="search-date-to"
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={handleDate("to")}
              onClick={openPicker}
            />
          </div>
        </div>
      )}
    </div>
  );
}
