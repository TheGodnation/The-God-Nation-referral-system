import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Avatar } from '../Avatar';

export interface LiveItem {
  personId: string;
  name: string;
  photoUrl: string | null;
  topicEn: string | null;
  topicFr: string | null;
  firstMessageId: string;
  lastAudioAt: string;
}

/** How often the banner checks again while the chat is open and in front. */
const CHECK_EVERY_MS = 30_000;

// A red banner at the top of a group chat while someone is teaching in it: their photo, "{Name} is teaching now" with the topic,
// and a button that takes you to the first audio of the teaching. It shows from the teacher's first voice note and goes away by
// itself when the teacher finishes, or once no new voice note has come for a quarter of an hour. Nothing shows the rest of the time. `refreshKey` changes whenever the chat
// gets a new message, so the banner appears within moments of the first audio, not only at the next check.
export function TeachingLiveBanner({ communityId, refreshKey, onListen }: { communityId: string; refreshKey?: string | null; onListen: (messageId: string) => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<LiveItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<{ items: LiveItem[] }>(`/api/communities/${communityId}/conversation/teaching-now`)
        .then((r) => alive && setItems(Array.isArray(r?.items) ? r.items : []))
        .catch(() => {});
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), CHECK_EVERY_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [communityId, refreshKey]);

  if (items.length === 0) return null;
  const french = i18n.language.startsWith('fr');
  return (
    <div className="border-b border-red-200 bg-red-50 text-red-950" data-testid="teaching-live">
      {items.map((i) => {
        const topic = (french ? i.topicFr : i.topicEn) ?? i.topicEn ?? i.topicFr;
        return (
          <div key={i.personId} className="flex items-center gap-2 px-3 py-2" data-testid="teaching-live-item">
            <Avatar name={i.name} photoUrl={i.photoUrl} size={32} />
            <p className="min-w-0 flex-1 text-sm leading-tight">
              <span className="flex items-center gap-1.5 font-semibold">
                <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" />
                <span className="truncate">{t('teachingLive.title', { name: i.name })}</span>
              </span>
              {topic && <span className="block truncate text-xs text-red-900/80">{topic}</span>}
            </p>
            <button type="button" onClick={() => onListen(i.firstMessageId)} className="shrink-0 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" data-testid="teaching-live-listen">
              {t('teachingLive.listen')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
