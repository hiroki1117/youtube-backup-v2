import { parseHttpsUrl } from "@/lib/url";
import type { Video } from "@/types/video";

/**
 * バックアップ元のページ（動画の元 URL）を新しいタブで開くリンク（presentational）。
 * API 由来の URL を href に入れるため、https 以外（javascript: 等）は描画しない（NFR4）。
 * `noopener noreferrer` で開いた先から元ページを操作・参照させない（タブナビング対策）。
 */
export interface SourceLinkProps {
  video: Video;
  className?: string;
}

export function SourceLink({ video, className }: SourceLinkProps) {
  const url = parseHttpsUrl(video.videoUrl);
  if (url === null) {
    return null;
  }
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`元のページを開く: ${video.title}`}
      className={className ?? "text-sm text-primary hover:underline"}
      data-testid="source-link"
    >
      元のページ
    </a>
  );
}
