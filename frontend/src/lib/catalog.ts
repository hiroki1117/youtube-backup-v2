import type { Video } from "@/types/video";

/**
 * カタログ業務ロジック（U2 video-catalog）。
 * 一覧のソートを純粋関数として leaf の lib に置く（副作用なし・API 非依存）。
 * API はサーバーサイド任意ソート・カーソルページング非対応（requirements.md R-03/R-05）のため、
 * 取得済みの行をフロントで整列する（続きの読み込みは「もっと見る」で取得件数を増やす）。
 */

/** 一覧のソート順（backupDate 基準の昇順/降順）。表示ラベルではなく enum で状態を表す。 */
export type SortOrder = "asc" | "desc";

/**
 * backupDate（YYYY-MM-DD）でソートした新しい配列を返す（入力は破壊しない）。
 * backupDate は固定長 ISO 日付文字列のため辞書順比較が日付順と一致する。
 * 同一 backupDate の相対順は入力順を保持する（安定ソート。エンジン依存を避けるため index で明示安定化）。
 * (US2.3 / FR2.3 / R-05)
 *
 * @param videos ソート対象（不変）
 * @param order 昇順 "asc" / 降順 "desc"
 * @returns ソート済みの新しい配列
 */
export function sortVideos(videos: Video[], order: SortOrder): Video[] {
  const factor = order === "asc" ? 1 : -1;
  return videos
    .map((video, index) => ({ video, index }))
    .sort((a, b) => {
      if (a.video.backupDate < b.video.backupDate) {
        return -factor;
      }
      if (a.video.backupDate > b.video.backupDate) {
        return factor;
      }
      // 同一 backupDate は入力順を維持（安定化）
      return a.index - b.index;
    })
    .map((entry) => entry.video);
}
