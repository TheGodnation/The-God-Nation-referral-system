import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { CommunitySetupReminder } from './CommunitySetupReminder';

interface Counts {
  visitors: number; leads: number; registered: number; confirmed: number; profileCompleted: number;
  joinedGroup: number; firstChat: number; firstExam: number; returned7: number; returned30: number;
}
interface Row extends Counts { key: string; source: string; campaign: string | null }
interface Ambassador { name: string; registered: number; confirmed: number; profileCompleted: number; returned7: number }
interface Report { days: number; totals: Counts; bySource: Row[]; byAmbassador: Ambassador[]; byPlatform?: { platform: string; taps: number }[]; truncated: boolean }

const DAYS = [7, 30, 90] as const;

// The server counts taps by these names.
const PLATFORM_LABELS: Record<string, string> = {
  whatsapp_group_en: 'WhatsApp group (English)',
  whatsapp_group_fr: 'WhatsApp group (French)',
  whatsapp_channel: 'WhatsApp channel',
  telegram_group: 'Telegram group',
  telegram_channel: 'Telegram channel',
  messenger: 'Messenger',
  facebook_group: 'Facebook group',
  facebook: 'Facebook page',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

// The growth report: where people come from and how far they get. Shown to the
// central admin in the admin dashboard and in their own member profile.
export function GrowthPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .get<Report>(`${base}?days=${days}`)
      .then((r) => !cancelled && setReport(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [base, days]);

  const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? (p === 'unknown' ? t('growth.platform_unknown') : p);

  const cols: { key: keyof Counts; label: string }[] = [
    { key: 'visitors', label: t('growth.col_visitors') },
    { key: 'leads', label: t('growth.col_leads') },
    { key: 'registered', label: t('growth.col_registered') },
    { key: 'confirmed', label: t('growth.col_confirmed') },
    { key: 'profileCompleted', label: t('growth.col_profile') },
    { key: 'joinedGroup', label: t('growth.col_group') },
    { key: 'firstChat', label: t('growth.col_chat') },
    { key: 'firstExam', label: t('growth.col_exam') },
    { key: 'returned7', label: t('growth.col_back7') },
    { key: 'returned30', label: t('growth.col_back30') },
  ];

  return (
    <div className="space-y-4" data-testid="growth-panel">
      <CommunitySetupReminder />
      <div className="card space-y-2">
        <h2 className="font-semibold text-brand-900">{t('growth.title')}</h2>
        <p className="text-xs text-slate-500">{t('growth.hint')}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded-full px-3 py-1 text-sm font-medium ${days === d ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {t(`growth.days_${d}`)}
            </button>
          ))}
        </div>
      </div>

      {failed && <p role="alert" className="text-sm text-red-700">{t('growth.failed')}</p>}

      {report && (
        <>
          <div className="card overflow-x-auto">
            <h3 className="mb-2 font-semibold text-brand-900">{t('growth.totals')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {cols.map((c) => (
                <div key={c.key} className="rounded-lg bg-slate-50 p-3 text-center">
                  <p className="text-2xl font-bold text-brand-900" data-testid={`growth-total-${c.key}`}>{report.totals[c.key]}</p>
                  <p className="text-xs text-slate-500">{c.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">{t('growth.note')}</p>
            {report.truncated && <p className="text-xs text-amber-700">{t('growth.truncated')}</p>}
          </div>

          <div className="card overflow-x-auto">
            <h3 className="mb-2 font-semibold text-brand-900">{t('growth.by_source')}</h3>
            {report.bySource.length === 0 ? (
              <p className="text-sm text-slate-400">{t('growth.empty')}</p>
            ) : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2 pr-3">{t('growth.col_source')}</th>
                    <th className="py-2 pr-3">{t('growth.col_campaign')}</th>
                    {cols.map((c) => <th key={c.key} className="py-2 pr-3">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.bySource.map((r) => (
                    <tr key={r.key} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-medium">{r.source}</td>
                      <td className="py-2 pr-3">{r.campaign ?? t('growth.no_campaign')}</td>
                      {cols.map((c) => <td key={c.key} className="py-2 pr-3">{r[c.key]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {report.byPlatform && report.byPlatform.length > 0 && (
            <div className="card overflow-x-auto">
              <h3 className="mb-2 font-semibold text-brand-900">{t('growth.by_platform')}</h3>
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2 pr-3">{t('growth.col_platform')}</th>
                    <th className="py-2 pr-3">{t('growth.col_taps')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byPlatform.map((p) => (
                    <tr key={p.platform} className="border-b border-slate-50" data-testid={`growth-platform-${p.platform}`}>
                      <td className="py-2 pr-3 font-medium">{platformLabel(p.platform)}</td>
                      <td className="py-2 pr-3">{p.taps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.byAmbassador.length > 0 && (
            <div className="card overflow-x-auto">
              <h3 className="mb-2 font-semibold text-brand-900">{t('growth.by_ambassador')}</h3>
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="py-2 pr-3">{t('growth.col_ambassador')}</th>
                    <th className="py-2 pr-3">{t('growth.col_registered')}</th>
                    <th className="py-2 pr-3">{t('growth.col_confirmed')}</th>
                    <th className="py-2 pr-3">{t('growth.col_profile')}</th>
                    <th className="py-2 pr-3">{t('growth.col_back7')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byAmbassador.map((a, i) => (
                    <tr key={`${a.name}-${i}`} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-medium">{a.name}</td>
                      <td className="py-2 pr-3">{a.registered}</td>
                      <td className="py-2 pr-3">{a.confirmed}</td>
                      <td className="py-2 pr-3">{a.profileCompleted}</td>
                      <td className="py-2 pr-3">{a.returned7}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
