import { useEffect, useState } from "react";
import { dismiss, subscribe, type Notification, type NotifyKind } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ROLE_BY_KIND: Record<NotifyKind, "alert" | "status"> = {
  error: "alert",
  success: "status",
  info: "status",
};

const STYLE_BY_KIND: Record<NotifyKind, string> = {
  error: "border-destructive/40 bg-destructive text-destructive-foreground",
  success: "border-border bg-primary text-primary-foreground",
  info: "border-border bg-secondary text-secondary-foreground",
};

export function Toaster() {
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => subscribe(setItems), []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      // スマホでは右下の登録ボタンに重ならないよう、その上に出す。
      className="fixed inset-x-4 bottom-20 z-50 flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm md:bottom-4"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={ROLE_BY_KIND[item.kind]}
          className={cn(
            "flex items-start justify-between gap-3 rounded-md border p-3 text-sm shadow-md",
            STYLE_BY_KIND[item.kind],
          )}
        >
          <span className="min-w-0 break-words">{item.message}</span>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label="通知を閉じる"
            // 指で押せる大きさにしつつ、負のマージンでトーストの高さは変えない。
            className="-my-3 -mr-3 size-11 shrink-0 opacity-80 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
