import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { api, ApiError } from '../lib/api';

interface ClinicData {
  rhythm: { examEveryDays: number; examQuestions: number; topicRhythm: 'DAILY' | 'EVERY_2_DAYS' | 'EVERY_3_DAYS' | 'MORNING_EVENING' };
  exams: {
    assessmentId: string;
    number: number;
    monthTitleEn: string;
    monthTitleFr: string | null;
    opensAt: string;
    open: boolean;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    passed: boolean | null;
    takenAt: string | null;
    tokens: number | null;
  }[];
  total: { exams: number; score: number; maxScore: number };
  /** Whether the member receives the monthly book (they can unsubscribe). */
  subscribed?: boolean;
}

// "Dominion Clinic": what it is, how it works (the book, the daily teaching,
// the exams and how often), and the member's own exam scores with the total.
export function MemberClinicPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [data, setData] = useState<ClinicData | null>(null);
  const [failed, setFailed] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ClinicData>('/api/member/clinic')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  async function setSubscribed(subscribed: boolean) {
    if (!subscribed && !window.confirm(t('clinicPage.sub_confirm') ?? '')) return;
    setSubBusy(true);
    setSubError(null);
    try {
      const res = await api.put<{ subscribed: boolean }>('/api/member/clinic/subscription', { subscribed });
      setData((d) => (d ? { ...d, subscribed: res.subscribed } : d));
    } catch (err) {
      setSubError(err instanceof ApiError ? err.message : t('clinicPage.sub_failed'));
    } finally {
      setSubBusy(false);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long' });

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('clinicPage.title')}</h1>
          <NotificationBell />
        </div>
        <p className="font-medium text-slate-800">{t('clinicPage.subtitle')}</p>
        <p className="text-slate-700">{t('clinicPage.about')}</p>

        <section className="card space-y-2">
          <h2 className="font-semibold text-brand-900">{t('clinicPage.how_title')}</h2>
          <ol className="list-decimal space-y-2 pl-5 text-slate-700">
            <li>{t('clinicPage.step_book')}</li>
            <li>{t('clinicPage.step_teaching')}</li>
            <li>{t('clinicPage.step_read')}</li>
            <li>{data ? t('clinicPage.step_exam', { days: data.rhythm.examEveryDays, count: data.rhythm.examQuestions }) : t('clinicPage.step_exam_plain')}</li>
            <li>{t('clinicPage.step_gift')}</li>
          </ol>
          {data && <p className="text-sm text-slate-600">{t(`clinicPage.rhythm_${data.rhythm.topicRhythm.toLowerCase()}`)}</p>}
          <p className="text-sm text-slate-600">{t('clinicPage.questions_from_book')}</p>
          <p className="flex flex-wrap gap-4 text-sm">
            <Link to="/member/learn" className="text-brand-700 underline">{t('clinicPage.go_learn')}</Link>
            <Link to="/member/give" className="text-brand-700 underline">{t('clinicPage.go_give')}</Link>
            <Link to="/member/tokens" className="text-brand-700 underline">{t('tokens.title')}</Link>
          </p>
        </section>

        {data && typeof data.subscribed === 'boolean' && (
          <section className="card space-y-2" data-testid="clinic-subscription">
            <h2 className="font-semibold text-brand-900">{t('clinicPage.sub_title')}</h2>
            <p className="text-sm text-slate-700">{data.subscribed ? t('clinicPage.sub_on') : t('clinicPage.sub_off')}</p>
            {subError && <p role="alert" className="text-sm text-red-700">{subError}</p>}
            <button type="button" className={data.subscribed ? 'btn-secondary' : 'btn-primary'} disabled={subBusy} onClick={() => void setSubscribed(!data.subscribed)}>
              {data.subscribed ? t('clinicPage.sub_unsubscribe') : t('clinicPage.sub_resubscribe')}
            </button>
          </section>
        )}

        <section className="card space-y-2" data-testid="clinic-results">
          <h2 className="font-semibold text-brand-900">{t('clinicPage.results_title')}</h2>
          {failed && <p className="text-sm text-red-700">{t('clinicPage.load_failed')}</p>}
          {!data && !failed && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
          {data && data.exams.length === 0 && <p className="text-sm text-slate-500">{t('clinicPage.no_exams')}</p>}
          {data && data.exams.length > 0 && (
            <>
              <p className="text-lg font-semibold text-slate-900">
                {data.total.exams === 0 ? t('clinicPage.total_none') : t('clinicPage.total', { score: data.total.score, max: data.total.maxScore, exams: data.total.exams })}
              </p>
              <ul className="divide-y divide-slate-100 text-sm">
                {data.exams.map((e) => (
                  <li key={e.assessmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {t('clinicPage.exam_n', { number: e.number })}
                      <span className="block text-xs text-slate-500">{isFr ? e.monthTitleFr || e.monthTitleEn : e.monthTitleEn}</span>
                    </span>
                    <span className="text-right">
                      {e.score !== null ? (
                        <span className={e.passed ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                          {e.score} / {e.maxScore} ({Math.round(e.percentage ?? 0)}%)
                          {typeof e.tokens === 'number' && <span className="block text-xs font-normal text-amber-700">👑 {t('clinicPage.tokens_earned', { count: e.tokens })}</span>}
                        </span>
                      ) : e.open ? (
                        <Link to={`/member/assessments/${e.assessmentId}`} className="text-brand-700 underline">{t('clinicPage.take')}</Link>
                      ) : new Date(e.opensAt).getTime() > Date.now() ? (
                        <span className="text-slate-500">{t('learn.opens_on', { date: date(e.opensAt) })}</span>
                      ) : (
                        <span className="text-slate-400">{t('learn.closed')}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <p className="text-center text-sm">
          <Link to="/member/me" className="text-brand-700 underline">{t('giving.back')}</Link>
        </p>
        <MemberNav />
      </section>
    </PageShell>
  );
}
