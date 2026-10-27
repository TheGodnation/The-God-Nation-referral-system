import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

// The live list under a teaching, open to everyone in the assembly: who the
// system has approved as having read / listened, and each person's quiz
// score. It refreshes by itself while the page is open, so people appear
// as they finish. The central admin also sees who has not finished and can
// send a reminder.

export interface TeachingResultsData {
  totals: { members: number; opened: number; finished: number; taken: number; passed: number; averagePercentage: number | null };
  participants: { personId: string; name: string; photoUrl: string | null; finishedAt: string | null; percentage: number | null; passed: boolean | null; takenAt: string | null }[];
  notFinished?: { personId: string; name: string; photoUrl?: string | null }[];
  passMark: number;
}

const REFRESH_MS = 20000;
const PENDING_SHOWN = 12;

export function TeachingResults({
  teachingId,
  mediaKind,
  hasText,
  myPersonId,
  canManage,
  refreshKey,
}: {
  teachingId: string;
  mediaKind: 'AUDIO' | 'VIDEO' | 'PDF' | null;
  hasText: boolean;
  myPersonId: string | undefined;
  canManage: boolean;
  /** Changes when the viewer's own progress changes, to refresh at once. */
  refreshKey: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<TeachingResultsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [reminder, setReminder] = useState<string | null>(null);
  const [showAllPending, setShowAllPending] = useState(false);

  const load = useCallback(() => {
    api
      .get<TeachingResultsData>(`/api/teachings/${teachingId}/results`)
      .then((r) => {
        setData(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [teachingId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function remind() {
    setReminder(null);
    try {
      const res = await api.post<{ sent: number }>(`/api/teachings/${teachingId}/remind`, {});
      setReminder(t('teaching.reminder_sent', { count: res.sent }));
    } catch (err) {
      setReminder(err instanceof ApiError ? err.message : t('teaching.reminder_failed'));
    }
  }

  const doneLabel = mediaKind === 'AUDIO' ? t('teaching.done_listened') : mediaKind === 'VIDEO' ? t('teaching.done_watched') : t('teaching.done_read');
  const doneLabelFull = hasText && mediaKind && mediaKind !== 'PDF' ? `${t('teaching.done_read')} + ${doneLabel}` : doneLabel;

  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm" aria-live="polite">
      <h2 className="font-semibold text-slate-900">{t('teaching.results_title')}</h2>
      {failed && !data && <p className="text-sm text-red-700">{t('teaching.results_failed')}</p>}
      {!data && !failed && <p className="text-sm text-slate-500">{t('teaching.loading')}</p>}
      {data && (
        <>
          <p className="text-sm text-slate-600" data-testid="teaching-totals">
            {t('teaching.totals', { finished: data.totals.finished, members: data.totals.members })}
            {' · '}
            {t('teaching.totals_quiz', { taken: data.totals.taken, passed: data.totals.passed })}
            {data.totals.averagePercentage !== null && ` · ${t('teaching.totals_average', { percent: data.totals.averagePercentage })}`}
          </p>
          <p className="text-xs text-slate-500">{t('teaching.results_note', { mark: data.passMark })}</p>

          {data.participants.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">{t('teaching.nobody_yet')}</p>
          ) : (
            <ol className="divide-y divide-slate-100" data-testid="teaching-participants">
              {data.participants.map((p) => {
                const mine = p.personId === myPersonId;
                return (
                  <li key={p.personId} className={`flex items-center gap-3 py-2 ${mine ? 'rounded-lg bg-emerald-50 px-2' : ''}`}>
                    <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <Link to={mine ? '/member/me' : `/member/people/${p.personId}`} className="block truncate font-medium text-slate-900 no-underline">
                        {p.name}
                        {mine && <span className="ml-1 text-xs font-normal text-emerald-700">({t('teaching.you')})</span>}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {p.finishedAt ? `✓ ${doneLabelFull}` : ''}
                      </p>
                    </div>
                    {p.percentage !== null ? (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ${p.passed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
                        aria-label={`${Math.round(p.percentage)}% ${p.passed ? t('teaching.passed') : t('teaching.not_passed')}`}
                      >
                        {Math.round(p.percentage)}% {p.passed ? '✓' : '✗'}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">{t('teaching.quiz_pending')}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {data.notFinished && (
            <div className="space-y-2 border-t border-slate-100 pt-3" data-testid="teaching-pending">
              <h3 className="text-sm font-semibold text-slate-800">{t('teaching.not_finished', { count: data.notFinished.length })}</h3>
              {data.notFinished.some((m) => m.personId === myPersonId) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                  {t('teaching.you_pending')}
                </p>
              )}
              {data.notFinished.length === 0 ? (
                <p className="text-sm text-slate-500">{t('teaching.all_finished')}</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {data.notFinished.slice(0, showAllPending ? undefined : PENDING_SHOWN).map((m) => {
                      const mine = m.personId === myPersonId;
                      return (
                        <li key={m.personId} className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-sm ${mine ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
                          <Avatar name={m.name} photoUrl={m.photoUrl} size={24} />
                          <span className="max-w-[10rem] truncate">
                            {m.name}
                            {mine && ` (${t('teaching.you')})`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {data.notFinished.length > PENDING_SHOWN && (
                    <button type="button" className="text-sm font-medium text-brand-700 underline" onClick={() => setShowAllPending((v) => !v)}>
                      {showAllPending ? t('teaching.pending_less') : t('teaching.pending_more', { count: data.notFinished.length - PENDING_SHOWN })}
                    </button>
                  )}
                </>
              )}
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary px-3 py-1.5" onClick={remind} disabled={data.notFinished.length === 0}>
                    🔔 {t('teaching.remind')}
                  </button>
                  {reminder && <p className="text-sm text-slate-600">{reminder}</p>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
