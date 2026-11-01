/**
 * 検索入力から video_id を抽出する純粋関数（U3 video-search / US3.1 / FR3.1）。
 * 入力が YouTube URL の場合は動画 ID を抽出し、それ以外は入力そのものを ID として扱う。
 * 副作用・API 依存を持たない leaf（lib）に置き、hook（useVideoSearch）から利用する
 * （レイヤ一方向依存: components → hooks → api → types (+lib leaf)）。
 */

/** URL とみなすホスト集合（www. は正規化して比較する）。 */
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);
const YOUTUBE_PATH_ID_PREFIXES = new Set(["shorts", "embed", "live", "v"]);
const TIKTOK_HOSTS = new Set(["tiktok.com", "m.tiktok.com"]);

/** パスの先頭空要素を除いたセグメント配列を返す。 */
function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

/**
 * 入力（生の video_id または YouTube URL）から video_id を抽出する。
 *
 * - 生 ID（URL でない文字列）: trim した入力をそのまま ID とする。
 * - `https://www.youtube.com/watch?v=ID`（クエリ付き含む）: `v` パラメータを ID とする。
 * - `https://youtu.be/ID`（クエリ付き含む）: パス先頭セグメントを ID とする。
 * - `https://www.youtube.com/shorts|embed|live/ID`: パス 2 番目のセグメントを ID とする。
 * - `https://www.tiktok.com/@user/video/ID`: パス 3 番目のセグメントを ID とする（短縮リンクは特定不能）。
 * - 空文字・空白のみ: `null`。
 * - URL だが ID を特定できない場合: `null`。
 *
 * @param input 検索フォームの入力値
 * @returns 抽出された video_id、抽出できなければ `null`
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  // URL として解釈できない場合は生 video_id として扱う。
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = url.hostname.replace(/^www\./, "");

  // youtu.be 短縮 URL: パス先頭セグメントが video_id。
  if (host === "youtu.be") {
    const [id] = pathSegments(url.pathname);
    return id !== undefined && id !== "" ? id : null;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    // watch?v=ID（クエリ付き含む）を最優先で抽出する。
    const paramId = url.searchParams.get("v");
    if (paramId !== null && paramId !== "") {
      return paramId;
    }
    // /shorts/ID・/embed/ID・/live/ID・/v/ID のパス形式。
    const segments = pathSegments(url.pathname);
    if (segments.length >= 2 && YOUTUBE_PATH_ID_PREFIXES.has(segments[0])) {
      return segments[1];
    }
    return null;
  }

  if (TIKTOK_HOSTS.has(host)) {
    const segments = pathSegments(url.pathname);
    return segments.length >= 3 && segments[1] === "video" ? segments[2] : null;
  }

  // その他ホストの URL: `v` パラメータがあれば拾い、なければ ID 特定不能。
  const fallbackId = url.searchParams.get("v");
  return fallbackId !== null && fallbackId !== "" ? fallbackId : null;
}
