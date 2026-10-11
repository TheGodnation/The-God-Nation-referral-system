import type { CSSProperties } from 'react';

// Home page and chat background. Every preset below is a tiny inline SVG
// pattern (like WhatsApp's doodle background) kept right in the app
// bundle — zero extra download, so it stays fast on 2G/3G. An Admin may
// instead upload a custom image (see lib/usePublicSettings.ts /
// server/src/routes/appBranding.ts); resolveWallpaperStyle below prefers
// that when set, falling back to the chosen preset, falling back to the
// first preset ("classic") when nothing has ever been set.

function doodlePattern(bg: string, strokeColor: string, dotColor: string): CSSProperties {
  const pattern = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='${strokeColor}' stroke-opacity='0.07' stroke-width='2' stroke-linecap='round'><path d='M20 12v16M12 20h16'/><path d='M84 70c0-5 7-7 9-2 2-5 9-3 9 2 0 6-9 11-9 11s-9-5-9-11z'/><path d='M70 22l6 6m0-6l-6 6'/><path d='M22 86v14M15 93h14'/></g><g fill='${dotColor}' fill-opacity='0.06'><circle cx='100' cy='18' r='3'/><circle cx='54' cy='104' r='3'/><circle cx='48' cy='52' r='2'/></g></svg>`;
  return {
    backgroundColor: bg,
    backgroundImage: `url("data:image/svg+xml;utf8,${pattern}")`,
    backgroundSize: '120px 120px',
  };
}

export interface WallpaperPreset {
  id: string;
  /** A representative solid color, for a small swatch in the admin picker. */
  swatch: string;
  style: CSSProperties;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'classic', swatch: '#efeae2', style: doodlePattern('#efeae2', '%23122a78', '%23122a78') },
  { id: 'sky', swatch: '#eaf3fb', style: doodlePattern('#eaf3fb', '%23274a66', '%23274a66') },
  { id: 'sage', swatch: '#eef3ea', style: doodlePattern('#eef3ea', '%232f4a30', '%232f4a30') },
  { id: 'blush', swatch: '#fbeef0', style: doodlePattern('#fbeef0', '%235a2a35', '%235a2a35') },
  { id: 'sand', swatch: '#f6efe4', style: doodlePattern('#f6efe4', '%234a3a28', '%234a3a28') },
];

const DEFAULT_PRESET = WALLPAPER_PRESETS[0];

/** The style to apply for a wallpaper, given the Admin's current choice
 * (from GET /api/settings/public's homeWallpaper/chatWallpaper). An
 * uploaded image always wins over a preset; no choice at all falls back
 * to the built-in default ("classic"). */
export function resolveWallpaperStyle(preset: string | null, imageUrl: string | null): CSSProperties {
  if (imageUrl) {
    return { backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }
  return (WALLPAPER_PRESETS.find((p) => p.id === preset) ?? DEFAULT_PRESET).style;
}
