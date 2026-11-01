import { parseHttpsUrl } from "@/lib/url";

/**
 * 署名 URL のダウンロードを起動する。https でなければ開かず false を返す。
 * @param filename ファイル名のヒント（空ならブラウザ既定）
 */
export function downloadPresignedUrl(url: string, filename?: string): boolean {
  const parsed = parseHttpsUrl(url);
  if (parsed === null) {
    return false;
  }
  const anchor = document.createElement("a");
  anchor.href = parsed.href;
  // クロスオリジンで download が無効になると新規タブへ遷移するため、タブナビング対策を付ける。
  anchor.rel = "noopener noreferrer";
  anchor.download = filename?.trim() ? filename : "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
