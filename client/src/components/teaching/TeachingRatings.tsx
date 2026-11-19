import { useTranslation } from 'react-i18next';
import { LEVELS, type LevelCounts, type WeekResult } from './teachingTypes';

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
