import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

interface ReportRow {
  id: string;
  targetType: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporter: { personId: string; name: string };
  reported: { personId: string; name: string };
}

// Member reports for review. Used by the admin (every report, basePath
// /api/admin/member-reports) and by leaders (reports about members of
// their groups, basePath /api/leader/member-reports).
export function ReportsList({ basePath, title }: { basePath: string; title?: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [items, setItems] = useState<ReportRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Hidden for viewers who may not review reports (e.g. a leader account
  // not yet linked to a person).
  const [hidden, setHidden] = useState(false);

  function load() {
    setItems(null);
    setError(null);
    api
      .get<{ items: ReportRow[] }>(`${basePath}?status=${status}`)
      .then((r) => setItems(r.items))
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setHidden(true);
        else setError(t('reports.load_failed'));
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [basePath, status]);

  async function resolve(id: string) {
    try {
      await api.post(`${basePath}/${id}/resolve`, { note: notes[id]?.trim() || undefined });
      load();
    } catch {
      setError(t('reports.resolve_failed'));
    }
  }

  if (hidden) return null;

  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB');

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{title ?? t('reports.title')}</h2>
        <div className="flex gap-2">
          {(['OPEN', 'RESOLVED'] as const).map((s) => (
            <button key={s} type="button" className={status === s ? 'btn-primary px-3 py-1.5 text-sm' : 'btn-secondary px-3 py-1.5 text-sm'} onClick={() => setStatus(s)}>
              {s === 'OPEN' ? t('reports.open') : t('reports.resolved')}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {items === null && !error && <p className="text-sm text-slate-400">{t('reports.loading')}</p>}
      {items?.length === 0 && <p className="text-sm text-slate-500">{status === 'OPEN' ? t('reports.none_open') : t('reports.none_resolved')}</p>}
      <ul className="space-y-3">
        {items?.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <p>
              <span className="font-semibold">{r.reporter.name}</span> {t('reports.reported')} <span className="font-semibold">{r.reported.name}</span>
              <span className="text-slate-400"> · {when(r.createdAt)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">“{r.reason}”</p>
            {r.status === 'OPEN' ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  className="input flex-1"
                  aria-label={t('reports.note_label') ?? ''}
                  placeholder={t('reports.note_placeholder') ?? ''}
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
                <button type="button" className="btn-primary" onClick={() => resolve(r.id)}>
                  {t('reports.mark_resolved')}
                </button>
              </div>
            ) : (
              r.resolutionNote && <p className="mt-1 text-slate-500">{t('reports.note', { note: r.resolutionNote })}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
