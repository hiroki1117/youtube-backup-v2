import { SourceLink } from "@/components/SourceLink";
import { parseHttpsUrl } from "@/lib/url";
import type { UploadStatus, Video } from "@/types/video";

/**
 * 動画の詳細（title/platform/backupDate/状態）を表示する presentational コンポーネント。
 * 元は `src/app/VideoPlaybackPage.tsx` のページローカル関数だったものを、Story 化のため
 * 挙動不変で move + export した（US-6）。DOM 契約（`dl` + `data-testid="playback-detail"`）は維持する。
 * 副作用・API 依存を持たない（レイヤ境界: components → types のみ）。
 */

// upload_status enum → 表示ラベル。制御フローは enum で分岐し、ラベルでは分岐しない。
const STATUS_LABEL: Record<UploadStatus, string> = {
  init: "処理中",
  complete: "完了",
};

export interface VideoDetailProps {
  video: Video;
}

export function VideoDetail({ video }: VideoDetailProps) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="playback-detail">
      <dt className="text-muted-foreground">タイトル</dt>
      <dd className="font-medium">{video.title}</dd>
      <dt className="text-muted-foreground">プラットフォーム</dt>
      <dd>{video.platform}</dd>
      <dt className="text-muted-foreground">バックアップ日</dt>
      <dd>{video.backupDate}</dd>
      <dt className="text-muted-foreground">状態</dt>
      <dd>{STATUS_LABEL[video.uploadStatus]}</dd>
      {parseHttpsUrl(video.videoUrl) !== null ? (
        <>
          <dt className="text-muted-foreground">掲載元</dt>
          <dd>
            <SourceLink video={video} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}
