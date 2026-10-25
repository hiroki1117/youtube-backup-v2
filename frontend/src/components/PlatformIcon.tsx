/**
 * プラットフォーム名をアイコンで表示する（presentational）。
 * 既知のプラットフォーム（youtube / twitter(x)）はブランドアイコン、未知のものは名称テキストで表示する。
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

const PLATFORMS: Record<string, PlatformDef> = {
  youtube: YOUTUBE,
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
