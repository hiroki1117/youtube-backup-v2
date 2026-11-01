import type { Video } from "@/types/video";

export type SortOrder = "asc" | "desc";

/**
 * backupDate（YYYY-MM-DD）で並べた新しい配列を返す。同じ日付は入力順を保つ。
 * API は任意のソートに対応しないため、取得済みの行をここで並べる。
 */
export function sortVideos(videos: Video[], order: SortOrder): Video[] {
  const factor = order === "asc" ? 1 : -1;
  return [...videos].sort((a, b) => factor * a.backupDate.localeCompare(b.backupDate));
}
