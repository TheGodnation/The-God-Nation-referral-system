import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface Results {
  devotional: { id: string; titleEn: string; titleFr: string | null } | null;
  weeks: number[];
  items: { personId: string; name: string; weekly: (number | null)[]; training: string; booksPassed: number }[];
}

// Leader dashboard: how each member of the leader's groups is doing in
// Exam World — first-try score per week of the current devotional, and
// leadership-training books passed. Shows who is active and who needs help.
export function ExamResults() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Results | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api
      .get<Results>('/api/leader/exam-results')
      .then(setData)
      .catch(() => setHidden(true));
  }, []);

  if (hidden || !data || data.items.length === 0) return null;
  const isFr = i18n.language.startsWith('fr');

  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-1 font-semibold text-brand-900">{t('examResults.title')}</h2>
      {data.devotional && (
        <p className="mb-3 text-sm text-slate-500">{isFr ? data.devotional.titleFr || data.devotional.titleEn : data.devotional.titleEn}</p>
      )}
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400">
            <th className="py-2 pr-3">{t('examResults.member')}</th>
            {data.weeks.map((w) => (
              <th key={w} className="py-2 pr-3">
                {t('examResults.week', { number: w })}
              </th>
            ))}
            <th className="py-2 pr-3">{t('examResults.books_passed')}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((p) => (
            <tr key={p.personId} className="border-b border-slate-50">
              <td className="py-2 pr-3">{p.name}</td>
              {p.weekly.map((score, i) => (
                <td key={i} className={`py-2 pr-3 ${score === null ? 'text-slate-300' : score >= 50 ? 'text-green-700' : 'text-red-700'}`}>
                  {score === null ? '—' : `${Math.round(score)}%`}
                </td>
              ))}
              <td className="py-2 pr-3">{p.training === 'ACTIVE' ? p.booksPassed : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
