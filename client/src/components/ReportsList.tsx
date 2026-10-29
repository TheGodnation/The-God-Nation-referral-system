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
  /** For a reported post or comment: what it said (null once it is removed). */
  targetId?: string | null;
  targetPreview?: string | null;
  outcome?: 'VIOLATION' | 'NO_VIOLATION' | null;
}

type Outcome = 'VIOLATION' | 'NO_VIOLATION';

// Member reports for review. Used by the admin (every report, basePath
// /api/admin/member-reports) and by leaders (reports about members of
// their groups, basePath /api/leader/member-reports).
export function ReportsList({ basePath, title }: { basePath: string; title?: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [items, setItems] = useState<ReportRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [removeIt, setRemoveIt] = useState<Record<string, boolean>>({});
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
      const outcome = outcomes[id];
      await api.post(`${basePath}/${id}/resolve`, {
        note: notes[id]?.trim() || undefined,
        outcome,
        removeContent: outcome === 'VIOLATION' && removeIt[id] ? true : undefined,
      });
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
            {(r.targetType === 'UPDATE_POST' || r.targetType === 'UPDATE_COMMENT') && (
              <p className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1 text-slate-600" data-testid="report-target">
                {r.targetPreview ? t('reports.what_was_posted', { text: r.targetPreview }) : t('reports.post_removed')}
              </p>
            )}
            {r.status === 'OPEN' ? (
              <div className="mt-2 space-y-2">
                <fieldset className="space-y-1">
                  <legend className="text-xs font-semibold text-slate-600">{t('reports.outcome_title')}</legend>
                  {(['VIOLATION', 'NO_VIOLATION'] as const).map((o) => (
                    <label key={o} className="flex items-start gap-2 text-slate-800">
                      <input type="radio" className="mt-1" name={`outcome-${r.id}`} checked={outcomes[r.id] === o} onChange={() => setOutcomes({ ...outcomes, [r.id]: o })} />
                      {t(`reports.outcome_${o}`)}
                    </label>
                  ))}
                </fieldset>
                {outcomes[r.id] === 'VIOLATION' && (r.targetType === 'UPDATE_POST' || r.targetType === 'UPDATE_COMMENT') && r.targetPreview && (
                  <label className="flex items-start gap-2 text-slate-800">
                    <input type="checkbox" className="mt-1" checked={Boolean(removeIt[r.id])} onChange={(e) => setRemoveIt({ ...removeIt, [r.id]: e.target.checked })} />
                    {t(r.targetType === 'UPDATE_POST' ? 'reports.remove_post' : 'reports.remove_comment')}
                  </label>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="input flex-1"
                    aria-label={t('reports.note_label') ?? ''}
                    placeholder={t('reports.note_placeholder') ?? ''}
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                  <button type="button" className="btn-primary" disabled={!outcomes[r.id]} onClick={() => resolve(r.id)}>
                    {t('reports.mark_resolved')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {r.outcome && <p className="mt-1 font-medium text-slate-700">{t(`reports.outcome_${r.outcome}_short`)}</p>}
                {r.resolutionNote && <p className="mt-1 text-slate-500">{t('reports.note', { note: r.resolutionNote })}</p>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
