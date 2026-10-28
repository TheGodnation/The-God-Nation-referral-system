import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInView } from '../../lib/chatMedia';
import { useDataSaver } from '../../lib/dataSaver';
import { YoutubeEmbed } from './YoutubeEmbed';

export type SocialProvider = 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'FACEBOOK' | 'OTHER';

export interface SocialEmbedInfo {
  provider: SocialProvider;
  url: string;
  /** Built by the server from a link it checked; null = show a link card. */
  src: string | null;
}

// Only these exact addresses are ever loaded in a player, even though the
// server already builds them itself — a second lock on the door.
const ALLOWED_PREFIXES = [
  'https://www.youtube-nocookie.com/embed/',
  'https://www.tiktok.com/embed/v2/',
  'https://www.instagram.com/p/',
  'https://www.instagram.com/reel/',
  'https://www.instagram.com/tv/',
  'https://www.facebook.com/plugins/post.php?',
  'https://www.facebook.com/plugins/video.php?',
];

export function isAllowedEmbedSrc(src: string | null | undefined): src is string {
  return Boolean(src && ALLOWED_PREFIXES.some((p) => src.startsWith(p)));
}

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  OTHER: '',
};

/** Roughly how tall each site's player is, so the feed doesn't jump. */
function playerHeight(provider: SocialProvider, src: string): number {
  if (provider === 'TIKTOK') return 740;
  if (provider === 'INSTAGRAM') return 720;
  if (provider === 'FACEBOOK') return src.includes('/plugins/video.php') ? 520 : 600;
  return 480;
}

// A shared TikTok / Instagram / Facebook / YouTube post, playing right
// inside the feed — the member never leaves the app. It only loads once it
// scrolls into view (and, with "Save data" on, only after a tap), so a feed
// full of videos stays light on mobile data.
export function SocialEmbed({ embed }: { embed: SocialEmbedInfo }) {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  const saver = useDataSaver();
  const [wanted, setWanted] = useState(false);
  const label = PROVIDER_LABEL[embed.provider];

  if (embed.provider === 'YOUTUBE' && embed.src && isAllowedEmbedSrc(embed.src)) {
    const id = embed.src.split('/embed/')[1]?.split('?')[0];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return <YoutubeEmbed videoId={id} />;
  }

  if (!isAllowedEmbedSrc(embed.src)) {
    // Not something we can play inside the app: a simple link card.
    return (
      <a
        href={embed.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
      >
        <span className="text-2xl" aria-hidden>
          🔗
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">{label ? t('share.open_on', { site: label }) : t('share.open_link')}</span>
          <span className="block truncate text-xs text-slate-500">{embed.url}</span>
        </span>
      </a>
    );
  }

  const height = playerHeight(embed.provider, embed.src);
  const show = inView && (!saver || wanted);

  return (
    <div ref={ref} className="w-full overflow-hidden rounded-lg bg-white" style={{ minHeight: show ? height : 160 }}>
      {show ? (
        <iframe
          src={embed.src}
          title={t('share.player_title', { site: label }) ?? label}
          className="mx-auto block w-full border-0"
          style={{ height, maxWidth: embed.provider === 'TIKTOK' ? 340 : 540 }}
          loading="lazy"
          scrolling="no"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        />
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-2 bg-slate-100 text-sm text-slate-500">
          <span className="text-3xl" aria-hidden>
            ▶
          </span>
          {saver && !wanted ? (
            <button type="button" onClick={() => setWanted(true)} className="rounded-full bg-black/55 px-3 py-1.5 font-semibold text-white">
              ⬇ {t('network.tap_to_load')}
            </button>
          ) : (
            <span>{label}</span>
          )}
        </div>
      )}
    </div>
  );
}
