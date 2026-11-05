import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { PortraitCard } from '../components/PortraitCard';
import { api } from '../lib/api';

interface Rep {
  personId: string;
  name: string;
  photoUrl: string | null;
  title: string;
  level: string;
  place: string;
  inYourArea: boolean;
}
interface TeamMember {
  personId: string;
  name: string;
  photoUrl: string | null;
  title: string;
}
interface Wall {
  inYourArea: Rep[];
  elsewhere: Rep[];
  nationalTeam: TeamMember[];
}

/**
 * "Meet The God Nation representatives in your area": a wall of their photos. The ones who represent the
 * viewer's own place come first; then the others, and the National Team. Tapping a photo opens that person's
 * profile. Asking to represent your own area is a page of its own (/member/represent).
 */
export function MemberRepresentativesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [wall, setWall] = useState<Wall | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<Wall>('/api/member/leadership-directory/representatives')
      .then(setWall)
      .catch(() => setFailed(true));
  }, []);

  const grid = (reps: Rep[]) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="reps-grid">
      {reps.map((r) => (
        <PortraitCard key={`${r.personId}-${r.place}`} name={r.name} photoUrl={r.photoUrl} caption={`${r.title} · ${r.place.split(',')[0]}`} className="w-full" onClick={() => navigate(`/member/people/${r.personId}`)} />
      ))}
    </div>
  );

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold leading-snug text-brand-900">{t('representatives.title')}</h1>
          <Link to="/member/people" className="shrink-0 pt-2 text-sm text-brand-700 underline">
            {t('leadershipDirectory.back')}
          </Link>
        </div>

        <Link to="/member/represent" className="flex items-center justify-center gap-2 rounded-xl bg-gold-400 px-3 py-2.5 text-sm font-semibold text-brand-950 no-underline hover:bg-gold-500" data-testid="request-link">
          <span aria-hidden>🙋</span>
          {t('people.represent_button')}
        </Link>

        {failed && <p className="card text-sm text-red-700">{t('representatives.load_failed')}</p>}
        {!wall && !failed && <p className="text-center text-slate-400">{t('memberDashboard.loading')}</p>}

        {wall && (
          <>
            <section className="card space-y-3" aria-labelledby="reps-mine">
              <h2 id="reps-mine" className="font-semibold text-brand-900">
                {t('representatives.in_your_area')}
              </h2>
              {wall.inYourArea.length > 0 ? (
                grid(wall.inYourArea)
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600" data-testid="none-in-area">
                  {t('representatives.none_in_area')}
                </p>
              )}
            </section>

            {wall.nationalTeam.length > 0 && (
              <section className="card space-y-3" aria-labelledby="reps-team">
                <h2 id="reps-team" className="font-semibold text-brand-900">
                  {t('leadershipDirectory.team_title')}
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {wall.nationalTeam.map((m) => (
                    <PortraitCard key={m.personId} name={m.name} photoUrl={m.photoUrl} caption={m.title} className="w-full" onClick={() => navigate(`/member/people/${m.personId}`)} />
                  ))}
                </div>
              </section>
            )}

            {wall.elsewhere.length > 0 && (
              <section className="card space-y-3" aria-labelledby="reps-elsewhere">
                <h2 id="reps-elsewhere" className="font-semibold text-brand-900">
                  {t('representatives.elsewhere')}
                </h2>
                {grid(wall.elsewhere)}
              </section>
            )}

            <p className="text-center text-sm">
              <Link to="/member/leadership" className="text-brand-700 underline">
                {t('representatives.full_directory')}
              </Link>
            </p>
          </>
        )}

        <MemberNav />
      </section>
    </PageShell>
  );
}
