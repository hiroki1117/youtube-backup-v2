/**
 * URL の安全化・検証（team code style: https 検証 / NFR4）。
 * 外部 URL を開く前・API へ送る前のクライアント検証を一箇所に集約し、
 * `openExternalUrl`（utils）と登録フォーム（U4）で共通利用する（leaf lib）。
 */

/**
 * 入力を trim して https URL として解釈する。
 * 空文字・URL 構文不正・https 以外はすべて null（タブナビング・スキーム injection 対策）。
 * @param input 検証前の文字列
 * @returns 検証済み URL、不正なら null
 */
export function parseHttpsUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  return parsed;
}

/** 動画 URL のクライアント検証結果（discriminated union。表示テキストで分岐しない）。 */
export type VideoUrlValidation = { ok: true; url: string } | { ok: false; reason: string };

/**
 * 登録フォームの URL をクライアント側で検証する（US4.1 / NFR4）。
 * 送信前に検証し、不正時は API を叩かずフォーム内エラーへ回す（サーバー往復を避ける）。
 * 失敗理由は kind ではなく人間可読メッセージ（reason）で返し、UI はそのまま描画する。
 * @param input フォーム入力値
 * @returns 検証成功なら正規化済み URL、失敗なら理由
 */
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
 * 再生リスト ID の解釈・検証は backend（`GET /youtube/playlist`）が行う。
 * 再生中の動画に再生リストが付いた URL（`watch?v=…&list=…`）は動画 1 本として扱う（ここでは false）。
 * @param url `validateVideoUrl` を通った URL
 */
export function isYoutubePlaylistUrl(url: string): boolean {
  const parsed = new URL(url);
  return (
    YOUTUBE_PLAYLIST_HOSTS.has(parsed.hostname.toLowerCase()) &&
    parsed.pathname === "/playlist" &&
    Boolean(parsed.searchParams.get("list"))
  );
}
