import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { api } from '../lib/api';
import { TeachingGuideView, TeachingTopicView } from '../components/teaching/TeachingTopicView';
import { slotLabel, type TeachingView, type TeachingWeek } from '../components/teaching/teachingTypes';
import { TeachingRatings, TeachingResults } from '../components/teaching/TeachingRatings';

// A teacher's own page: what they teach this week, when, the book to read, and how to teach it. Next week's topic is
// shown too, so they can prepare. Nobody else's assignment is ever sent to this page.
function WeekCard({ week, label, open, showHow }: { week: TeachingWeek; label: string; open: boolean; showHow: boolean }) {
  const { t, i18n } = useTranslation();
  const when = slotLabel(week.startsAt, i18n.language);
  return (
    <section className="card space-y-3" data-testid={`week-${week.weekStart}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <h2 className="text-lg font-bold text-brand-900">{week.text.topic}</h2>
        <p className="text-sm text-slate-700">
          🕖 {when.cameroon} <span className="text-slate-500">({t('teachingRota.cameroon_time')})</span>
        </p>
        {when.local && (
          <p className="text-sm text-slate-500">
            {t('teachingRota.your_time')}: {when.local}
          </p>
        )}
        {week.status === 'done' && <p className="mt-1 text-sm font-semibold text-green-700">✓ {t('teachingRota.done')}</p>}
        {week.status === 'now' && <p className="mt-1 text-sm font-semibold text-amber-700">{t('teachingRota.now')}</p>}
        {showHow && <p className="mt-1 text-sm text-slate-600">{t('teachingRota.how_send')}</p>}
      </div>
      {week.book?.canOpen && (
        <Link to={`/member/read/${week.book.id}`} className="btn-secondary inline-flex w-full justify-center" data-testid="open-book">
          📖 {t('teachingRota.open_book')}
        </Link>
      )}
      <details open={open}>
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">{t('teachingRota.show_teaching')}</summary>
        <div className="mt-3">
          <TeachingTopicView text={week.text} />
        </div>
      </details>
    </section>
  );
}

export function MemberMyTeachingPage() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<TeachingView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<TeachingView>('/api/member/teaching-rota/me')
      .then((v) => alive && setView(v))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const started = view?.started ?? false;
  const startsOn = view?.startsOn ? new Date(`${view.startsOn}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-3 px-4 py-6 pb-16">
        <h1 className="text-2xl font-bold text-brand-900">{t('teachingRota.page_title')}</h1>
        {failed && <p className="text-sm text-red-700">{t('teachingRota.load_failed')}</p>}
        {!view && !failed && <p className="text-slate-500">{t('common.loading')}</p>}
        {view && (!view.enabled || (!view.isTeacher && !view.isRater)) && <p className="card text-sm text-slate-700" data-testid="not-a-teacher">{t('teachingRota.not_a_teacher')}</p>}
        {view?.isTeacher && view.weeks && (
          <>
            {!started && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="not-started">
                {t('teachingRota.starts_on', { date: startsOn })}
              </p>
            )}
            {view.weeks.map((w, i) => (
              <WeekCard key={w.weekStart} week={w} showHow={i === 0} open={i === 0 && w.status !== 'done'} label={i === 0 ? t(started ? 'teachingRota.this_week' : 'teachingRota.first_week') : t(started ? 'teachingRota.next_week' : 'teachingRota.week_after')} />
            ))}
            {view.results && <TeachingResults results={view.results} />}
            {view.guide && <TeachingGuideView guide={view.guide} open />}
          </>
        )}
        {view?.enabled && view.isRater && <TeachingRatings />}
        <MemberNav />
      </section>
    </PageShell>
  );
}
