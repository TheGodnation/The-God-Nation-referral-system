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
  isRead: boolean;
}

// Phase 3M.3 — shared authenticated recipient view for Central Authority
// targeted announcements, used identically by both the Member and Leader
// dashboards (same API, same display rules: no target/audience/internal
// info is ever shown here — see server/src/routes/announcements.ts). Not a
// global inbox: only announcements the caller currently qualifies for.
// Silent-hide when there is nothing to show, matching the established
// MyFollowUps/MyLeadershipProposals convention for an inapplicable section.
//
// Phase 3M.5 — read/unread state. Opening an announcement fetches its
// detail (a genuine GET, kept side-effect-free server-side) and, once that
// succeeds, fires POST .../read once to mark it read — never the other way
// around, and never from the list GET. A failed read-mark never blocks or
// hides the already-loaded detail content; it's a best-effort follow-up,
// not a precondition for reading.
export function Announcements() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnnouncementRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: AnnouncementRow[]; unreadCount: number }>('/api/me/announcements')
      .then((res) => {
        setItems(res.items);
        setUnreadCount(res.unreadCount);
        setLoading(false);
      })
      .catch(() => {
        setError(t('announcements.load_failed'));
        setLoading(false);
      });
  }, []);

  function markReadLocally(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: true } : i)));
    setDetail((prev) => (prev && prev.id === id ? { ...prev, isRead: true } : prev));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }

  function openAnnouncement(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    api
      .get<AnnouncementRow>(`/api/me/announcements/${id}`)
      .then((res) => {
        setDetail(res);
        setDetailLoading(false);
        if (!res.isRead) {
          // Best-effort: a failed read-mark must never affect the
          // already-rendered detail content above.
          api
            .post(`/api/me/announcements/${id}/read`)
            .then(() => markReadLocally(id))
            .catch(() => {});
        }
      })
      .catch(() => {
        setDetailError(t('announcements.load_failed'));
        setDetailLoading(false);
      });
  }

  function closeAnnouncement() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  if (loading) return null;
  if (!error && items.length === 0) return null;

  const isFr = i18n.language.startsWith('fr');

  if (selectedId) {
    return (
      <div className="card mt-6">
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={closeAnnouncement}>
          {t('announcements.back_to_list')}
        </button>
        {detailLoading && <p className="text-sm text-slate-400">{t('announcements.loading')}</p>}
        {detailError && <p className="text-sm text-red-700">{detailError}</p>}
        {detail && (
          <>
            <h2 className="mb-1 font-semibold text-brand-900">{isFr ? detail.titleFr || detail.titleEn : detail.titleEn}</h2>
            <p className="mb-3 text-xs text-slate-400">{new Date(detail.publishedAt).toLocaleDateString()}</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{isFr ? detail.bodyFr || detail.bodyEn : detail.bodyEn}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-brand-900">
        {t('announcements.title')}
        {unreadCount > 0 && (
          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{unreadCount}</span>
        )}
      </h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && (
        <ul className="space-y-2">
          {items.map((i) => {
            const title = isFr ? i.titleFr || i.titleEn : i.titleEn;
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                <div>
                  <p className={i.isRead ? 'font-medium text-brand-900' : 'font-semibold text-brand-900'}>
                    {title}
                    {!i.isRead && (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {t('announcements.unread_badge')}
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-slate-400">{new Date(i.publishedAt).toLocaleDateString()}</span>
                </div>
                <button className="text-brand-700 hover:underline" onClick={() => openAnnouncement(i.id)}>
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
