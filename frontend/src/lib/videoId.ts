const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);
const YOUTUBE_PATH_ID_PREFIXES = new Set(["shorts", "embed", "live", "v"]);
const TIKTOK_HOSTS = new Set(["tiktok.com", "m.tiktok.com"]);

/**
 * 検索語（生の video_id または動画 URL）から video_id を取り出す。
 * URL でなければ入力のまま、空や ID を特定できない URL は null（TikTok の短縮リンクも特定不能）。
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const queryId = url.searchParams.get("v") || null;

  if (host === "youtu.be") {
    return segments[0] ?? null;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const hasPathId = segments.length >= 2 && YOUTUBE_PATH_ID_PREFIXES.has(segments[0]);
    return queryId ?? (hasPathId ? segments[1] : null);
  }
  if (TIKTOK_HOSTS.has(host)) {
    return segments.length >= 3 && segments[1] === "video" ? segments[2] : null;
  }
  return queryId;
}
