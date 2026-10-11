import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface PresenceResponse {
  onlineNow: number;
  groups: { communityId: string; name: string; memberCount: number; onlineCount: number }[];
}

// Admin dashboard: how many people have the app open right now, in total
// and per group. Refreshes every 30 seconds.
export function AdminOnlineNow() {
  const { t } = useTranslation();
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<PresenceResponse>('/api/admin/presence')
        .then((r) => alive && setData(r))
        .catch(() => {});
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!data) return null;
  const groups = showAll ? data.groups : data.groups.slice(0, 5);

  return (
    <section className="card mb-6" aria-label={t('presence.title') ?? ''}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <h2 className="font-semibold text-brand-900">{t('presence.online_now', { count: data.onlineNow })}</h2>
      </div>
      {data.groups.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {groups.map((g) => (
            <li key={g.communityId} className="flex items-center justify-between py-1.5">
              <span className="truncate text-slate-700">{g.name}</span>
              <span className={g.onlineCount > 0 ? 'font-semibold text-emerald-700' : 'text-slate-400'}>
                {t('presence.group_line', { online: g.onlineCount, members: g.memberCount })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.groups.length > 5 && (
        <button type="button" className="mt-2 text-sm text-brand-700 underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('presence.show_less') : t('presence.show_all', { count: data.groups.length })}
        </button>
      )}
    </section>
  );
}
