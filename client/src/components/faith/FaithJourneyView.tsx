import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// One person's faith journey: what they answered about their walk with Christ at
// the end of the Book 1 / Book 2 exams, with the teacher's guide beside each
// answer, where they stand, and the private notes of whoever spoke with them.
// Only the central admin (and leaders, when he allows it) ever get here.

export interface FaithAnswer {
  order: number;
  signal: 'POSITIVE' | 'NEEDS_TALK';
  questionEn: string;
  questionFr: string | null;
  answerEn: string;
  answerFr: string | null;
  guideEn: string | null;
  guideFr: string | null;
}

export interface FaithTry {
  attemptId: string;
  answeredAt: string;
  book: { number: number | null; titleEn: string | null; titleFr: string | null };
  setNumber: number;
  attemptNumber: number;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  answers: FaithAnswer[];
}

export interface FaithJourney {
  person: { id: string; name: string; whatsappNumber: string | null };
  status: 'BORN_AGAIN' | 'NEEDS_CONVERSATION' | null;
  lastAnsweredAt: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  notes: { id: string; authorName: string; text: string; createdAt: string }[];
  tries: FaithTry[];
}

export function StatusChip({ status, confirmed }: { status: 'BORN_AGAIN' | 'NEEDS_CONVERSATION' | null; confirmed?: boolean }) {
  const { t } = useTranslation();
  if (!status) return null;
  const needs = status === 'NEEDS_CONVERSATION';
  const cls = needs ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`} data-testid="faith-status">
        {needs ? `🟡 ${t('faith.status_needs')}` : `✅ ${t('faith.status_born_again')}`}
      </span>
      {confirmed && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">{t('faith.confirmed_chip')}</span>}
    </span>
  );
}

export function FaithJourneyView({ base, personId, onBack }: { base: string; personId: string; onBack?: () => void }) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const pick = (en: string | null, fr: string | null) => (isFr ? fr || en || '' : en || '');
  const [journey, setJourney] = useState<FaithJourney | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState('loading');
    api
      .get<FaithJourney>(`${base}/${personId}`)
      .then((j) => {
        setJourney(j);
        setState('ready');
      })
      .catch(() => setState('none'));
  }, [base, personId]);

  async function act(fn: () => Promise<FaithJourney>) {
    setBusy(true);
    setError(null);
    try {
      setJourney(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('faith.failed'));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  return (
    <div className="space-y-4" data-testid="faith-journey">
      {onBack && (
        <button type="button" className="text-sm text-brand-700 hover:underline" onClick={onBack}>
          ← {t('faith.back')}
        </button>
      )}
      {state === 'loading' && <p className="text-sm text-slate-400">{t('faith.loading')}</p>}
      {state === 'none' && <p className="card text-sm text-slate-600">{t('faith.not_found')}</p>}
      {state === 'ready' && journey && (
        <>
          <div className="card space-y-2">
            <h2 className="text-lg font-bold text-brand-900">{journey.person.name}</h2>
            {journey.person.whatsappNumber && <p className="text-sm text-slate-500">{journey.person.whatsappNumber}</p>}
            <StatusChip status={journey.status} confirmed={Boolean(journey.confirmedAt)} />
            {journey.confirmedAt && (
              <p className="text-xs text-slate-600">
                {t('faith.confirmed_by', { name: journey.confirmedByName ?? '', date: when(journey.confirmedAt) })}
              </p>
            )}
            <button
              type="button"
              className={journey.confirmedAt ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
              disabled={busy || !journey.status}
              onClick={() => act(() => api.post<FaithJourney>(`${base}/${personId}/confirm`, { confirmed: !journey.confirmedAt }))}
            >
              {journey.confirmedAt ? t('faith.unconfirm') : t('faith.confirm')}
            </button>
            <p className="text-xs text-slate-500">{t('faith.confirm_help')}</p>
          </div>

          {journey.tries.map((tr) => (
            <section key={tr.attemptId} className="card space-y-3" data-testid="faith-try">
              <header>
                <h3 className="font-semibold text-brand-900">
                  {tr.book.number ? t('faith.book_exam', { number: tr.book.number }) : t('faith.exam')} · {when(tr.answeredAt)}
                </h3>
                <p className="text-xs text-slate-500">
                  {t('faith.try_line', { number: tr.attemptNumber, set: tr.setNumber })}
                  {tr.score !== null && tr.maxScore !== null ? ` · ${tr.score}/${tr.maxScore}` : ''}
                </p>
              </header>
              <ol className="space-y-3">
                {tr.answers.map((a) => (
                  <li key={a.order} className={`rounded-lg border p-3 ${a.signal === 'NEEDS_TALK' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                    <p className="text-sm text-slate-700">{pick(a.questionEn, a.questionFr)}</p>
                    <p className="mt-1 whitespace-pre-wrap font-semibold text-slate-900">
                      {a.signal === 'NEEDS_TALK' ? '⚑ ' : ''}
                      {pick(a.answerEn, a.answerFr)}
                    </p>
                    {a.guideEn && (
                      <p className="mt-2 rounded bg-white/70 px-2 py-1 text-xs text-slate-600">
                        <span className="font-semibold">{t('faith.guide')}</span> {pick(a.guideEn, a.guideFr)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {journey.tries.length === 0 && <p className="card text-sm text-slate-500">{t('faith.no_answers')}</p>}

          <section className="card space-y-3">
            <h3 className="font-semibold text-brand-900">{t('faith.notes_title')}</h3>
            <p className="text-xs text-slate-500">{t('faith.notes_help')}</p>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('faith.note_placeholder') ?? ''} aria-label={t('faith.note_placeholder') ?? ''} />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy || !note.trim()}
              onClick={async () => {
                const text = note.trim();
                await act(() => api.post<FaithJourney>(`${base}/${personId}/notes`, { text }));
                setNote('');
              }}
            >
              {t('faith.note_save')}
            </button>
            <ul className="space-y-2">
              {journey.notes.map((n) => (
                <li key={n.id} className="rounded bg-slate-50 px-3 py-2 text-sm">
                  <p className="whitespace-pre-wrap text-slate-800">{n.text}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {n.authorName} · {when(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
