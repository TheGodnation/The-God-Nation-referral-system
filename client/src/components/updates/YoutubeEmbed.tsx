import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// A YouTube video or live (video or audio-only). Shows the thumbnail
// first and only loads the real player when tapped, so a feed full of
// videos stays light on mobile data. `autoLoad` skips the thumbnail (used
// for the "Live now" banner). Only a validated 11-character id ever reaches
// here — we build the embed link ourselves.
export function YoutubeEmbed({ videoId, title, autoLoad = false }: { videoId: string; title?: string | null; autoLoad?: boolean }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(autoLoad);
  const label = title || t('updates.video');

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16 / 9' }}>
      {playing ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${autoLoad ? 0 : 1}&rel=0`}
          title={label}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button type="button" className="absolute inset-0 h-full w-full" onClick={() => setPlaying(true)} aria-label={t('updates.play_video', { title: label })}>
          <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" className="h-full w-full object-cover" loading="lazy" />
          <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-2xl text-white">
            ▶
          </span>
        </button>
      )}
    </div>
  );
}
