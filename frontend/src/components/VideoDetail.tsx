import { SourceLink } from "@/components/SourceLink";
import { parseHttpsUrl } from "@/lib/url";
import { STATUS_LABEL } from "@/lib/videoLabels";
import type { Video } from "@/types/video";

export function VideoDetail({ video }: { video: Video }) {
  return (
    <dl
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
      data-testid="playback-detail"
    >
      {/* スマホでは再生ページの見出しの直下に来て重複するので隠す。 */}
      <dt className="whitespace-nowrap text-muted-foreground max-md:hidden">タイトル</dt>
      <dd className="break-words font-medium max-md:hidden">{video.title}</dd>
      <dt className="whitespace-nowrap text-muted-foreground">プラットフォーム</dt>
      <dd>{video.platform}</dd>
      <dt className="whitespace-nowrap text-muted-foreground">バックアップ日</dt>
      <dd>{video.backupDate}</dd>
      <dt className="whitespace-nowrap text-muted-foreground">状態</dt>
      <dd>{STATUS_LABEL[video.uploadStatus]}</dd>
      {parseHttpsUrl(video.videoUrl) !== null ? (
        <>
          <dt className="whitespace-nowrap text-muted-foreground">掲載元</dt>
          <dd>
            <SourceLink video={video} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}
