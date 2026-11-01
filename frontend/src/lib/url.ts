/** 入力を trim して https URL として解釈する。それ以外（javascript: 等）は null。 */
export function parseHttpsUrl(input: string): URL | null {
  try {
    const parsed = new URL(input.trim());
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export type VideoUrlValidation = { ok: true; url: string } | { ok: false; reason: string };

/** 登録フォームの URL を検証する。失敗理由は画面にそのまま出す文言。 */
export function validateVideoUrl(input: string): VideoUrlValidation {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, reason: "URL を入力してください。" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "URL の形式が正しくありません。" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "https で始まる URL を指定してください。" };
  }
  return { ok: true, url: parsed.href };
}

const YOUTUBE_PLAYLIST_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

/**
 * 再生リストのページの URL（`youtube.com/playlist?list=…`）か。登録ダイアログの分岐だけに使い、
 * ID の解釈は backend が行う。`watch?v=…&list=…` は動画 1 本として扱う（false）。
 */
export function isYoutubePlaylistUrl(url: string): boolean {
  const parsed = new URL(url);
  return (
    YOUTUBE_PLAYLIST_HOSTS.has(parsed.hostname.toLowerCase()) &&
    parsed.pathname === "/playlist" &&
    Boolean(parsed.searchParams.get("list"))
  );
}
