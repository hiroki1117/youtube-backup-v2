/**
 * プラットフォーム名をアイコンで表示する（presentational）。
 * 既知のプラットフォーム（youtube / tiktok / twitter(x)）はブランドアイコン、未知のものは名称テキストで表示する。
 * アイコンは role="img" + aria-label で名称をスクリーンリーダーに伝える。
 */
export interface PlatformIconProps {
  platform: string;
  className?: string;
}

interface PlatformDef {
  label: string;
  path: string;
  colorClass: string;
}

const YOUTUBE: PlatformDef = {
  label: "YouTube",
  colorClass: "text-[#FF0000]",
  path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
};

const X: PlatformDef = {
  label: "X (Twitter)",
  colorClass: "text-foreground",
  path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
};

const TIKTOK: PlatformDef = {
  label: "TikTok",
  colorClass: "text-foreground",
  path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
};

const PLATFORMS: Record<string, PlatformDef> = {
  youtube: YOUTUBE,
  tiktok: TIKTOK,
  twitter: X,
  x: X,
};

/** プラットフォームの表示名（既知はブランド名、未知は値そのもの）。リンク文言などアイコン以外で使う。 */
export function platformLabel(platform: string): string {
  return PLATFORMS[platform.toLowerCase()]?.label ?? platform;
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const def = PLATFORMS[platform.toLowerCase()];
  if (def === undefined) {
    return <span className={className ?? "text-sm text-muted-foreground"}>{platform}</span>;
  }
  return (
    <svg
      role="img"
      aria-label={def.label}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className ?? `size-5 shrink-0 ${def.colorClass}`}
    >
      <title>{def.label}</title>
      <path d={def.path} />
    </svg>
  );
}
