import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { api } from '../lib/api';

interface TokensData {
  started: boolean;
  startsAt: string | null;
  usable: boolean;
  balance: { earned: number; bought: number; total: number };
  foundation: { total: number };
  clinicRate: number | null;
  nextHalving: { at: string; rate: number } | null;
  schedule: { fromYear: number; toYear: number | null; clinic: number; book: number }[];
  history: {
    id: string;
    at: string;
    reason: 'CLINIC_EXAM' | 'FOUNDATION_SHARE';
    kind: 'EARNED' | 'BOUGHT';
    amount: number;
    correctAnswers: number | null;
    ratePerAnswer: number | null;
    examNumber: number | null;
    monthTitleEn: string | null;
    monthTitleFr: string | null;
  }[];
}

const fmt = (n: number, lang: string) => n.toLocaleString(lang.startsWith('fr') ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });

// "King's Tokens": the member's own balance and history, what a correct answer
// earns now and when that halves, and the foundation's balance. Tokens only
// accumulate for now; they cannot be used until the announcement.
export function MemberTokensPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [data, setData] = useState<TokensData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<TokensData>('/api/member/tokens')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const day = (iso: string) => new Date(iso).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">👑 {t('tokens.title')}</h1>
          <NotificationBell />
        </div>
        <p className="text-slate-700">{t('tokens.intro')}</p>
        {failed && <p className="text-sm text-red-700">{t('tokens.load_failed')}</p>}
        {!data && !failed && <p className="text-sm text-slate-400">{t('common.loading')}</p>}

        {data && (
          <>
            <section className="card space-y-2" data-testid="tokens-balance">
              <h2 className="font-semibold text-brand-900">{t('tokens.balance')}</h2>
              <p className="text-3xl font-bold text-slate-900">{fmt(data.balance.total, i18n.language)}</p>
              <p className="text-sm text-slate-600">
                {t('tokens.earned')}: {fmt(data.balance.earned, i18n.language)}
                {data.balance.bought > 0 && <> · {t('tokens.bought')}: {fmt(data.balance.bought, i18n.language)}</>}
              </p>
              <p className="text-sm text-slate-500">{t('tokens.cannot_use_yet')}</p>
            </section>

            <section className="card space-y-2" data-testid="tokens-rate">
              {data.started && data.clinicRate !== null ? (
                <>
                  <p className="text-slate-800">{t('tokens.rate_now', { rate: fmt(data.clinicRate, i18n.language) })}</p>
                  <p className="text-sm text-slate-600">
                    {data.nextHalving ? t('tokens.next_halving', { date: day(data.nextHalving.at), rate: fmt(data.nextHalving.rate, i18n.language) }) : t('tokens.at_floor')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-slate-800">{t('tokens.not_started')}</p>
                  {data.startsAt && <p className="text-sm text-slate-600">{t('tokens.starts_on', { date: day(data.startsAt) })}</p>}
                </>
              )}
              <p className="text-sm text-slate-600">{t('tokens.first_try')}</p>
              <h3 className="pt-2 text-sm font-semibold text-brand-900">{t('tokens.schedule')}</h3>
              <ul className="text-sm text-slate-700">
                {data.schedule.map((r) => (
                  <li key={r.fromYear} className="flex justify-between gap-2 border-t border-slate-100 py-1">
                    <span>{r.toYear === null ? t('tokens.years_after', { from: r.fromYear }) : t('tokens.years_range', { from: r.fromYear, to: r.toYear })}</span>
                    <span>{t('tokens.per_answer', { rate: fmt(r.clinic, i18n.language) })}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card space-y-2" data-testid="tokens-history">
              <h2 className="font-semibold text-brand-900">{t('tokens.history')}</h2>
              {data.history.length === 0 && <p className="text-sm text-slate-500">{t('tokens.no_history')}</p>}
              <ul className="divide-y divide-slate-100 text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {h.reason === 'CLINIC_EXAM'
                        ? h.examNumber !== null
                          ? t('tokens.reason_clinic', { number: h.examNumber, month: (isFr ? h.monthTitleFr || h.monthTitleEn : h.monthTitleEn) ?? '', correct: h.correctAnswers ?? 0, rate: fmt(h.ratePerAnswer ?? 0, i18n.language) })
                          : t('tokens.reason_clinic_plain', { correct: h.correctAnswers ?? 0, rate: fmt(h.ratePerAnswer ?? 0, i18n.language) })
                        : t('tokens.reason_foundation')}
                      <span className="block text-xs text-slate-500">{day(h.at)}</span>
                    </span>
                    <span className={h.amount >= 0 ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                      {h.amount >= 0 ? '+' : ''}
                      {fmt(h.amount, i18n.language)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-sm text-slate-600" data-testid="tokens-foundation">{t('tokens.foundation', { amount: fmt(data.foundation.total, i18n.language) })}</p>
          </>
        )}

        <p className="flex flex-wrap justify-center gap-4 text-sm">
          <Link to="/member/clinic" className="text-brand-700 underline">{t('clinicPage.title')}</Link>
          <Link to="/member/me" className="text-brand-700 underline">{t('tokens.back')}</Link>
        </p>
        <MemberNav />
      </section>
    </PageShell>
  );
}
