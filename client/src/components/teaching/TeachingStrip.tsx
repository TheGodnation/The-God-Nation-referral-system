import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { slotLabel, type TeachingView } from './teachingTypes';

// A slim strip on the Chats page, shown only to a teacher on the rota (and only once the rota is switched on):
// when they teach next, and what on. Anyone else sees nothing.
export function TeachingStrip() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<TeachingView | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<TeachingView>('/api/member/teaching-rota/me')
      .then((v) => alive && setView(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!view?.enabled) return null;
  const teaching = view.isTeacher && view.weeks?.length ? (view.weeks.find((w) => w.status !== 'done') ?? view.weeks[0]) : null;
  if (!teaching) return null;
  const line = `${slotLabel(teaching.startsAt, i18n.language).cameroon} · ${teaching.text.topic}`;
  return (
    <Link to="/member/my-teaching" className="card mb-2 flex items-center gap-3 !p-3 no-underline" data-testid="teaching-strip">
      <span aria-hidden className="text-2xl">📖</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-brand-900">{t('teachingRota.strip_title')}</span>
        <span className="block truncate text-sm text-slate-600">{line}</span>
      </span>
      <span aria-hidden className="text-brand-700">›</span>
    </Link>
  );
}
