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
  notFinished?: { personId: string; name: string }[];
  passMark: number;
}

const REFRESH_MS = 20000;

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
  const [showNot, setShowNot] = useState(false);

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

          {canManage && data.notFinished && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="text-sm font-medium text-slate-700 underline" onClick={() => setShowNot((v) => !v)}>
                  {t('teaching.not_finished', { count: data.notFinished.length })}
                </button>
                <button type="button" className="btn-secondary px-3 py-1.5" onClick={remind} disabled={data.notFinished.length === 0}>
                  🔔 {t('teaching.remind')}
                </button>
              </div>
              {reminder && <p className="text-sm text-slate-600">{reminder}</p>}
              {showNot && (
                <ul className="columns-2 gap-4 text-sm text-slate-700">
                  {data.notFinished.map((m) => (
                    <li key={m.personId} className="truncate">
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
