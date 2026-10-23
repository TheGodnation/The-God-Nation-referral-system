import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { FollowUpConversation } from '../FollowUpConversation';

interface FollowUpRow {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  assignedAt: string;
  closedAt: string | null;
  follower: { id: string; name: string };
}

// Phase 3M.2 — a Member's own Follow-Up relationships (where they are the
// followedPersonId) and, for each, the shared FollowUpConversation. Never
// shows FollowUpContact (wellbeing/notes) — that stays a private Leader/
// Admin log, entirely separate from this component. Silent-hide when the
// Member has no Follow-Up relationships at all, matching the established
// MyLeadershipProposals convention for an inapplicable section.
export function MyFollowUps() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FollowUpRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: FollowUpRow[] }>('/api/member/me/follow-ups')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('memberFollowUps.load_failed'));
        setLoading(false);
      });
  }, []);

  if (loading) return null;
  if (!error && items.length === 0) return null;

  const selected = items.find((i) => i.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="card mt-6">
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={() => setSelectedId(null)}>
          {t('memberFollowUps.back_to_list')}
        </button>
        <h2 className="mb-1 font-semibold text-brand-900">{t('memberFollowUps.title')}</h2>
        <p className="mb-3 text-sm text-slate-500">{selected.follower.name}</p>
        <FollowUpConversation followUpAssignmentId={selected.id} />
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('memberFollowUps.title')}</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
              <div>
                <p className="font-medium text-brand-900">{i.follower.name}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    i.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {i.status === 'ACTIVE' ? t('memberFollowUps.status_active') : t('memberFollowUps.status_closed')}
                </span>
              </div>
              <button className="text-brand-700 hover:underline" onClick={() => setSelectedId(i.id)}>
                {t('memberFollowUps.open_conversation')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
