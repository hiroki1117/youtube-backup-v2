import { ExternalLink } from "lucide-react";
import { platformLabel } from "@/components/PlatformIcon";
import { parseHttpsUrl } from "@/lib/url";
import type { Video } from "@/types/video";

/**
 * バックアップ元の動画（元 URL）を新しいタブで開くリンク（presentational）。
 * 文言は行き先のプラットフォーム名で「YouTube で開く」とし、外部へ出ることを ↗ アイコンで示す。
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
  const text = `${platformLabel(video.platform) || "元サイト"} で開く`;
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${text}: ${video.title}`}
      className={className ?? "inline-flex items-center gap-1 text-sm text-primary hover:underline"}
      data-testid="source-link"
    >
      {text}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}
