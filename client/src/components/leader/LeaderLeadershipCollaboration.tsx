import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { LeadershipCollaboration } from '../LeadershipCollaboration';

interface GenerationItem {
  generation: number;
  unreadCount: number;
}

// Phase 2B — renders the shared LeadershipCollaboration panel once for
// every organizational generation the Leader is currently eligible for
// (see server/src/lib/leadershipCollaboration.ts). This component's own
// filtering only decides which panels to render — the server independently
// re-verifies eligibility for each generation on every request. No new
// page: this section lives directly on the existing Leader Dashboard.
export function LeaderLeadershipCollaboration() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [generations, setGenerations] = useState<GenerationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: GenerationItem[] }>('/api/leader/leadership-collaboration')
      .then((res) => {
        setGenerations(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('leader.leadershipCollaborationList.load_failed'));
        setLoading(false);
      });
  }, []);

  if (loading) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-1 font-semibold text-brand-900">{t('leader.leadershipCollaborationList.title')}</h2>
      <p className="mb-3 text-xs text-slate-400">{t('leader.leadershipCollaborationList.intro')}</p>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {!error && generations.length === 0 && (
        <p className="text-sm text-slate-400">{t('leader.leadershipCollaborationList.no_generations')}</p>
      )}

      {!error &&
        generations.map((g) => <LeadershipCollaboration key={g.generation} generation={g.generation} />)}
    </div>
  );
}
