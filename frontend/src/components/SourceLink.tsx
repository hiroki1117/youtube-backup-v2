import { ExternalLink } from "lucide-react";
import { platformLabel } from "@/components/PlatformIcon";
import { parseHttpsUrl } from "@/lib/url";
import type { Video } from "@/types/video";

/** API 由来の URL を href に入れるため、https 以外（javascript: 等）は描画しない。 */
export function SourceLink({ video }: { video: Video }) {
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
      // 負のマージンで、周囲の行間を変えずにタップ領域だけを広げる。
      className="-my-3 inline-flex items-center gap-1 py-3 text-sm text-primary hover:underline"
      data-testid="source-link"
    >
      {text}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}
