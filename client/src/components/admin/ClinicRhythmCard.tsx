import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type Rhythm = 'DAILY' | 'EVERY_2_DAYS' | 'EVERY_3_DAYS' | 'MORNING_EVENING';
interface Settings {
  topicRhythm: Rhythm;
  examEveryDays: number;
  examQuestions: number;
}

// The central admin sets the Dominion Clinic rhythm: how often a new topic is
// taught, the days between exams, and the questions an exam asks.
export function ClinicRhythmCard({ base }: { base: string }) {
  const { t } = useTranslation();
  const [s, setS] = useState<Settings | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.get<Settings>(`${base}/clinic/settings`).then(setS).catch(() => {});
  }, [base]);

  async function save() {
    if (!s) return;
    setMessage(null);
    try {
      await api.put(`${base}/clinic/settings`, s);
      setMessage({ kind: 'ok', text: t('clinicRhythm.saved') });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('clinicRhythm.failed') });
    }
  }

  if (!s) return null;
  return (
    <section className="card space-y-2" data-testid="clinic-rhythm">
      <h2 className="font-semibold text-brand-900">{t('clinicRhythm.title')}</h2>
      <p className="text-sm text-slate-600">{t('clinicRhythm.help')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="clinic-topic">{t('clinicRhythm.topic')}</label>
          <select id="clinic-topic" className="input" value={s.topicRhythm} onChange={(e) => setS({ ...s, topicRhythm: e.target.value as Rhythm })}>
            <option value="DAILY">{t('clinicRhythm.daily')}</option>
            <option value="EVERY_2_DAYS">{t('clinicRhythm.every_2_days')}</option>
            <option value="EVERY_3_DAYS">{t('clinicRhythm.every_3_days')}</option>
            <option value="MORNING_EVENING">{t('clinicRhythm.morning_evening')}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="clinic-days">{t('clinicRhythm.every_days')}</label>
          <input id="clinic-days" className="input" type="number" min={1} max={31} value={s.examEveryDays} onChange={(e) => setS({ ...s, examEveryDays: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor="clinic-questions">{t('clinicRhythm.questions')}</label>
          <input id="clinic-questions" className="input" type="number" min={1} max={50} value={s.examQuestions} onChange={(e) => setS({ ...s, examQuestions: Number(e.target.value) })} />
        </div>
      </div>
      <button type="button" className="btn-secondary" onClick={save}>{t('clinicRhythm.save')}</button>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
