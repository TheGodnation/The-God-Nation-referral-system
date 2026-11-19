import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { slotLabel, LEVELS, type Level, type LevelCounts, type WeekResult } from './teachingTypes';

interface ToRate {
  teacherId: string;
  weekStart: string;
  teacherName: string;
  topic: string;
  startsAt: string;
  myLevel: Level | null;
}

const TONE: Record<Level, string> = {
  EXCELLENT: 'border-green-600 bg-green-600 text-white',
  VERY_GOOD: 'border-emerald-500 bg-emerald-500 text-white',
  GOOD: 'border-sky-500 bg-sky-500 text-white',
  KEEP_GROWING: 'border-amber-500 bg-amber-500 text-white',
};

export function CountChips({ counts }: { counts: LevelCounts }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1.5">
      {LEVELS.filter((l) => counts[l] > 0).map((l) => (
        <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {counts[l]} × {t(`teachingRota.level_${l}`)}
        </span>
      ))}
    </span>
  );
}

// "Rate the teachings": the teachings that have ended, with four buttons each. The rating can be changed for a few days.
export function TeachingRatings() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ToRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ items: ToRate[] }>('/api/member/teaching-rota/to-rate')
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  async function choose(item: ToRate, level: Level) {
    setError(null);
    try {
      await api.post('/api/member/teaching-rota/rate', { teacherId: item.teacherId, weekStart: item.weekStart, level });
      setItems((prev) => prev?.map((i) => (i.teacherId === item.teacherId && i.weekStart === item.weekStart ? { ...i, myLevel: level } : i)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('teachingRota.rate_failed'));
    }
  }

  if (!items) return null;
  const waiting = items.filter((i) => !i.myLevel).length;
  return (
    <section className="space-y-2" data-testid="teaching-ratings">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('teachingRota.rate_title')}</h2>
        <p className="text-sm text-slate-600">{items.length === 0 ? t('teachingRota.rate_none') : t('teachingRota.rate_help', { count: waiting })}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {items.map((i) => (
        <div key={`${i.teacherId}-${i.weekStart}`} className="card space-y-2 !p-3" data-testid="rate-item">
          <div>
            <p className="font-semibold text-slate-900">{i.teacherName}</p>
            <p className="text-sm text-slate-700">{i.topic}</p>
            <p className="text-xs text-slate-500">{slotLabel(i.startsAt, i18n.language).cameroon}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={i.myLevel === l}
                onClick={() => void choose(i, l)}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold ${i.myLevel === l ? TONE[l] : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {t(`teachingRota.level_${l}`)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// For the teacher: how the last weeks were rated, as totals only (nobody's name).
export function TeachingResults({ results }: { results: WeekResult[] }) {
  const { t, i18n } = useTranslation();
  if (results.length === 0) return null;
  return (
    <section className="card space-y-2 !p-3" data-testid="teaching-results">
      <h2 className="text-base font-bold text-brand-900">{t('teachingRota.results_title')}</h2>
      <p className="text-xs text-slate-500">{t('teachingRota.results_help')}</p>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.weekStart} className="text-sm">
            <p className="font-medium text-slate-900">
              {new Date(`${r.weekStart}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} · {r.topic}
            </p>
            <CountChips counts={r.counts} />
          </li>
        ))}
      </ul>
    </section>
  );
}
