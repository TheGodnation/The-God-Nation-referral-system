import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { QuizSummary } from './QuizSummary';

// Every submitted quiz / exam try: teaching quizzes, leadership book exams,
// devotional exams. On the Results tab it can be searched by person, kind,
// assembly and dates; inside a person's page (personId) it is just their own
// list. Each line can be copied as a short message for WhatsApp, and the
// whole filtered list downloads as a spreadsheet.

interface ResultRow {
  attemptId: string;
  assessmentId: string;
  personId: string;
  personName: string;
  whatsappNumber: string;
  kind: 'TEACHING' | 'BOOK' | 'DEVOTIONAL' | 'OTHER';
  title: string;
  assemblyName: string | null;
  tryNumber: number;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  submittedAt: string | null;
}

interface ResultPage {
  items: ResultRow[];
  pagination: { page: number; totalPages: number; total: number };
}

const KINDS = ['TEACHING', 'BOOK', 'DEVOTIONAL', 'OTHER'] as const;

export function ExamResults({
  personId,
  base = '/api/admin/results',
  hideWhenEmpty = false,
}: {
  personId?: string;
  /** A leader reads the same list over their own members only. */
  base?: string;
  hideWhenEmpty?: boolean;
}) {
  const isAdmin = base === '/api/admin/results';
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResultPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [summaryFor, setSummaryFor] = useState<string | null>(null);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      if (personId) p.set('personId', personId);
      if (search.trim()) p.set('search', search.trim());
      if (kind) p.set('kind', kind);
      if (communityId) p.set('communityId', communityId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p.toString();
    },
    [personId, search, kind, communityId, from, to],
  );

  const load = useCallback(() => {
    setFailed(false);
    api
      .get<ResultPage>(`${base}?${query({ page: String(page), pageSize: '20' })}`)
      .then((r) => (Array.isArray(r?.items) && r.pagination ? setData(r) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [query, page]);

  useEffect(load, [load]);

  useEffect(() => {
    if (personId || !isAdmin) return;
    api
      .get<{ items: { id: string; name: string }[] }>('/api/admin/communities?pageSize=100')
      .then((r) => setCommunities(r.items))
      .catch(() => {});
  }, [personId, isAdmin]);

  const locale = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const kindLabel = (k: ResultRow['kind']) => t(`admin.results.kind_${k}`);

  function line(r: ResultRow) {
    const date = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const result = r.passed === null ? '' : `, ${t(r.passed ? 'admin.results.passed' : 'admin.results.failed')}`;
    return t('admin.results.copy_line', {
      name: r.personName,
      title: r.title,
      kind: kindLabel(r.kind).toLowerCase(),
      percent: r.percentage === null ? '—' : Math.round(r.percentage),
      result,
      date,
    });
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      /* clipboard not available: nothing to do */
    }
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    if (page === 1) load();
    else setPage(1);
  }

  if (hideWhenEmpty && (failed || (data && data.pagination.total === 0 && !search && !kind && !from && !to))) return null;

  return (
    <div className="space-y-3" data-testid="exam-results">
      {!isAdmin && <h2 className="font-semibold text-brand-900">{t('admin.results.leader_title')}</h2>}
      {!personId && (
        <form onSubmit={applyFilters} className="card grid gap-2 sm:grid-cols-2">
          <input className="input sm:col-span-2" placeholder={t('admin.results.search_placeholder') ?? ''} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('admin.results.search_placeholder') ?? ''} />
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label={t('admin.results.kind') ?? ''}>
            <option value="">{t('admin.results.all_kinds')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
          {isAdmin && (
          <select className="input" value={communityId} onChange={(e) => { setCommunityId(e.target.value); setPage(1); }} aria-label={t('admin.results.assembly') ?? ''}>
            <option value="">{t('admin.results.all_assemblies')}</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          )}
          <label className="text-xs text-slate-500">
            {t('admin.results.from')}
            <input type="date" className="input mt-1" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="text-xs text-slate-500">
            {t('admin.results.to')}
            <input type="date" className="input mt-1" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </label>
          <button type="submit" className="btn-primary sm:col-span-2">
            {t('admin.results.search_button')}
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a className="btn-secondary" href={`${base}/export?${query()}`} download data-testid="results-download">
          ⬇ {t('admin.results.download')}
        </a>
        {data && data.items.length > 0 && (
          <button type="button" className="btn-secondary" onClick={() => copy('all', data.items.map(line).join('\n'))}>
            {copied === 'all' ? `✓ ${t('admin.results.copied')}` : `📋 ${t('admin.results.copy_shown')}`}
          </button>
        )}
        {data && <span className="text-xs text-slate-500">{t('admin.results.count', { count: data.pagination.total })}</span>}
      </div>

      {failed && <p className="card text-sm text-red-700">{t('admin.results.failed_load')}</p>}
      {!data && !failed && <p className="py-6 text-center text-sm text-slate-400">{t('admin.results.loading')}</p>}
      {data && data.items.length === 0 && <p className="card text-sm text-slate-500">{t('admin.results.none')}</p>}

      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map((r) => (
            <li key={r.attemptId} className="card flex items-start justify-between gap-3" data-testid="result-row">
              <div className="min-w-0">
                {!personId && <p className="font-medium text-slate-900">{r.personName}</p>}
                <p className="break-words text-sm text-slate-700">
                  <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{kindLabel(r.kind)}</span>
                  {r.title}
                </p>
                <p className="text-xs text-slate-500">
                  {[r.assemblyName, r.submittedAt ? new Date(r.submittedAt).toLocaleDateString(locale) : null, r.tryNumber > 1 ? t('admin.results.try_n', { n: r.tryNumber }) : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-lg font-bold ${r.passed === null ? 'text-slate-700' : r.passed ? 'text-green-700' : 'text-red-700'}`}>{r.percentage === null ? '—' : `${Math.round(r.percentage)}%`}</p>
                {r.passed !== null && <p className="text-xs text-slate-500">{t(r.passed ? 'admin.results.passed' : 'admin.results.failed')}</p>}
                <button type="button" className="mt-1 block w-full text-xs font-medium text-brand-700 underline" onClick={() => copy(r.attemptId, line(r))}>
                  {copied === r.attemptId ? `✓ ${t('admin.results.copied')}` : t('admin.results.copy')}
                </button>
                <button type="button" className="mt-1 block w-full text-xs font-medium text-brand-700 underline" onClick={() => setSummaryFor(r.assessmentId)}>
                  {t('admin.results.quiz_summary')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {summaryFor && <QuizSummary base={base} assessmentId={summaryFor} detail={isAdmin} onClose={() => setSummaryFor(null)} />}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← {t('admin.results.previous')}
          </button>
          <span className="text-slate-500">
            {page} / {data.pagination.totalPages}
          </span>
          <button type="button" className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
            {t('admin.results.next')} →
          </button>
        </div>
      )}
    </div>
  );
}
