import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../PageShell';
import { MemberNav } from './MemberNav';
import { programmeTotal, type SchoolSummary } from '../learn/schoolBits';
import { cachedGet } from '../../lib/cachedGet';
import { useMemberAuth } from '../../lib/MemberAuthContext';

// What a member who is not yet a leader sees when they open "My Leadership
// Dashboard": it opens, but the tools are locked, and the page invites them
// into the Leadership Academy — the road to becoming a leader.
export function LeadershipLockedPage() {
  const { t } = useTranslation();
  const { member } = useMemberAuth();
  const [school, setSchool] = useState<SchoolSummary | null>(null);

  useEffect(() => {
    let alive = true;
    cachedGet<SchoolSummary>('/api/member/school', `school:${member?.personId ?? ''}`)
      .then((r) => alive && setSchool(r.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [member?.personId]);

  const total = school ? programmeTotal(school) : 0;
  const passed = (school?.books ?? []).filter((b) => b.exam?.passed).length;
  const started = school?.enrollment === 'ACTIVE';

  const tools = ['tool_people', 'tool_followups', 'tool_teachings', 'tool_rooms', 'tool_reports'] as const;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8" data-testid="leadership-locked">
        <div className="mb-5 rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-5 text-white shadow">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">🔒 {t('leadershipLocked.badge')}</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{t('leadershipLocked.title')}</h1>
          <p className="mt-2 text-sm text-brand-100">{t('leadershipLocked.intro')}</p>
        </div>

        <div className="card mb-4">
          <h2 className="mb-2 font-semibold text-brand-900">{t('leadershipLocked.what_heading')}</h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {tools.map((k) => (
              <li key={k}>🔒 {t(`leadershipLocked.${k}`)}</li>
            ))}
          </ul>
        </div>

        <div className="card mb-4">
          <h2 className="mb-2 font-semibold text-brand-900">{t('leadershipLocked.how_heading')}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>{t('leadershipLocked.step_study', { count: total })}</li>
            <li>{t('leadershipLocked.step_exams')}</li>
            <li>{t('leadershipLocked.step_appointed')}</li>
          </ol>
          {started && <p className="mt-3 text-sm font-semibold text-brand-800">{t('school.progress', { passed, total })}</p>}
          <Link to="/member/school" className="btn-primary mt-4 inline-block no-underline">
            {started ? t('leadershipLocked.continue_cta') : t('leadershipLocked.start_cta')}
          </Link>
        </div>

        <MemberNav />
      </section>
    </PageShell>
  );
}
