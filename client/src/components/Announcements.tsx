import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

interface AnnouncementRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  publishedAt: string;
}

// Phase 3M.3 — shared authenticated recipient view for Central Authority
// targeted announcements, used identically by both the Member and Leader
// dashboards (same API, same display rules: no target/audience/internal
// info is ever shown here — see server/src/routes/announcements.ts). Not a
// global inbox: only announcements the caller currently qualifies for.
// Silent-hide when there is nothing to show, matching the established
// MyFollowUps/MyLeadershipProposals convention for an inapplicable section.
export function Announcements() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: AnnouncementRow[] }>('/api/me/announcements')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('announcements.load_failed'));
        setLoading(false);
      });
  }, []);

  if (loading) return null;
  if (!error && items.length === 0) return null;

  const isFr = i18n.language.startsWith('fr');
  const selected = items.find((i) => i.id === selectedId) ?? null;

  if (selected) {
    const title = isFr ? selected.titleFr || selected.titleEn : selected.titleEn;
    const body = isFr ? selected.bodyFr || selected.bodyEn : selected.bodyEn;
    return (
      <div className="card mt-6">
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={() => setSelectedId(null)}>
          {t('announcements.back_to_list')}
        </button>
        <h2 className="mb-1 font-semibold text-brand-900">{title}</h2>
        <p className="mb-3 text-xs text-slate-400">{new Date(selected.publishedAt).toLocaleDateString()}</p>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{body}</p>
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('announcements.title')}</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && (
        <ul className="space-y-2">
          {items.map((i) => {
            const title = isFr ? i.titleFr || i.titleEn : i.titleEn;
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                <div>
                  <p className="font-medium text-brand-900">{title}</p>
                  <span className="text-xs text-slate-400">{new Date(i.publishedAt).toLocaleDateString()}</span>
                </div>
                <button className="text-brand-700 hover:underline" onClick={() => setSelectedId(i.id)}>
                  {t('announcements.read_more')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
