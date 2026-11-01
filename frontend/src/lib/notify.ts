/** トースト通知の pub/sub。`notify` をどの層からも呼べ、`Toaster` が購読して描画する。 */
export type NotifyKind = "success" | "info" | "error";

export interface Notification {
  id: number;
  kind: NotifyKind;
  message: string;
}

type Listener = (notifications: Notification[]) => void;

let notifications: Notification[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function update(next: Notification[]): void {
  notifications = next;
  listeners.forEach((listener) => listener(notifications));
}

export function notify(kind: NotifyKind, message: string): void {
  update([...notifications, { id: nextId++, kind, message }]);
}

export function dismiss(id: number): void {
  update(notifications.filter((n) => n.id !== id));
}

export function clearNotifications(): void {
  update([]);
}

/** 通知の変更を購読する。戻り値の関数で購読解除。 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(notifications);
  return () => {
    listeners.delete(listener);
  };
}
