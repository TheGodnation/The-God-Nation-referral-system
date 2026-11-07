import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface Row {
  leaderId: string;
  name: string;
  email: string;
  active: boolean;
  codes: string[];
  visits: number;
  uniqueVisitors: number;
  referred: number;
  tappedGroup: number;
  inApp: number;
  inAssembly: number;
  conversionRate: number;
  firstReferralAt: string | null;
  lastReferralAt: string | null;
}
interface Report {
  rows: Row[];
  totals: { visits: number; uniqueVisitors: number; referred: number; tappedGroup: number; inApp: number; inAssembly: number; conversionRate: number };
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <p className="text-lg font-bold leading-tight text-brand-900">{value}</p>
      <p className="text-[11px] leading-tight text-slate-600">{label}</p>
    </div>
  );
}

// How each leader did under the first referral system: link clicks, sign-ups through the link, taps on "join the
// WhatsApp group", people now in the app and in an assembly. A spreadsheet of all of it can be downloaded. Offered in
// the admin dashboard and in the central admin's member profile (base says which set of routes).
export function LeaderReferralReportPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [includeTest, setIncludeTest] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setReport(null);
    setFailed(false);
    api.get<Report>(`${base}/?includeTestData=${includeTest}`).then(setReport).catch(() => setFailed(true));
  }, [base, includeTest]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (report?.rows ?? []).filter((r) => !q || `${r.name} ${r.email} ${r.codes.join(' ')}`.toLowerCase().includes(q));
  }, [report, search]);

  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(i18n.language) : '—');
  return (
    <div className="space-y-4" data-testid="leader-referral-report">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('refReport.title')}</h2>
        <p className="text-sm text-slate-600">{t('refReport.help')}</p>
      </div>
      {failed && <p className="text-sm text-red-700">{t('refReport.load_failed')}</p>}
      {!report && !failed && <p className="text-sm text-slate-500">{t('instructions.loading')}</p>}
      {report && (
        <>
          <section className="card space-y-2" data-testid="referral-totals">
            <p className="font-semibold text-slate-800">{t('refReport.all_leaders', { count: report.rows.length })}</p>
            <div className="grid grid-cols-3 gap-2">
              <Figure label={t('refReport.signed_up')} value={report.totals.referred} />
              <Figure label={t('refReport.tapped_group')} value={report.totals.tappedGroup} />
              <Figure label={t('refReport.in_app')} value={report.totals.inApp} />
              <Figure label={t('refReport.in_assembly')} value={report.totals.inAssembly} />
              <Figure label={t('refReport.clicks')} value={report.totals.visits} />
              <Figure label={t('refReport.conversion')} value={`${report.totals.conversionRate}%`} />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1" placeholder={t('refReport.search') ?? ''} value={search} onChange={(e) => setSearch(e.target.value)} />
            <a className="btn-secondary px-3 py-2 text-sm no-underline" href={`${base}/export?includeTestData=${includeTest}`} data-testid="referral-export">
              ⬇ {t('refReport.download')}
            </a>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
            {t('refReport.include_test')}
          </label>

          <ul className="space-y-2">
            {shown.map((r) => (
              <li key={r.leaderId} className="card space-y-2" data-testid={`referral-row-${r.leaderId}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-brand-900">{r.name}</span>
                    <span className="block truncate text-xs text-slate-500">{r.email}{r.codes.length > 0 ? ` · ${r.codes.join(', ')}` : ''}</span>
                  </span>
                  {!r.active && <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">{t('refReport.turned_off')}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Figure label={t('refReport.signed_up')} value={r.referred} />
                  <Figure label={t('refReport.tapped_group')} value={r.tappedGroup} />
                  <Figure label={t('refReport.in_app')} value={r.inApp} />
                  <Figure label={t('refReport.in_assembly')} value={r.inAssembly} />
                  <Figure label={t('refReport.clicks')} value={r.visits} />
                  <Figure label={t('refReport.conversion')} value={`${r.conversionRate}%`} />
                </div>
                <p className="text-xs text-slate-500">{t('refReport.dates', { first: day(r.firstReferralAt), last: day(r.lastReferralAt), visitors: r.uniqueVisitors })}</p>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="card text-sm text-slate-600">{t('refReport.none')}</p>}
          <p className="text-xs text-slate-500">{t('refReport.note')}</p>
        </>
      )}
    </div>
  );
}
