import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { YoutubeEmbed } from './YoutubeEmbed';
import { Avatar } from '../Avatar';

export interface LiveAuthor {
  personId: string;
  name: string;
  photoUrl: string | null;
  title: string | null;
}

export interface LiveInfo {
  youtubeVideoId: string;
  title: string | null;
  startedAt: string;
  // Section 15: null means the plain institutional "Central Authority" voice.
  author: LiveAuthor | null;
}

// "Live now" at the top of the Updates page, when the central admin is
// streaming on YouTube (video or audio-only). Hidden when nothing is live.
export function LiveBanner() {
  const { t } = useTranslation();
  const [live, setLive] = useState<LiveInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .get<{ live: LiveInfo | null }>('/api/updates/live')
        .then((res) => !cancelled && setLive(res.live))
        .catch(() => {});
    }
    load();
    // Check again every minute so a live that starts while the page is
    // open appears without a refresh.
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!live) return null;

  return (
    <div className="card space-y-3 border-2 border-red-500">
      <div className="flex items-center gap-2">
        <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">{t('updates.live_badge')}</span>
        <span className="font-semibold text-brand-900">{live.title || t('updates.live_default_title')}</span>
      </div>
      {live.author && (
        <div className="flex items-center gap-2">
          <Avatar name={live.author.name} photoUrl={live.author.photoUrl} size={32} />
          <div>
            <p className="text-sm font-medium text-brand-900">{live.author.name}</p>
            {live.author.title && <p className="text-xs text-slate-500">{live.author.title}</p>}
          </div>
        </div>
      )}
      <YoutubeEmbed videoId={live.youtubeVideoId} title={live.title} autoLoad />
    </div>
  );
}
