import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { suggestEmailFix } from '../../lib/emailTypo';
import { SignInHelpPanel } from './SignInHelpCard';

// Admin → Sign-in trouble: everyone who tried to sign in (leader page or
// app) or started joining, and is still stuck — with their email, so the
// central admin can reach out. See GET /api/admin/sign-in-trouble.

interface TroubleItem {
  email: string;
  kind: 'LEADER_SIGN_IN' | 'MEMBER_SIGN_IN' | 'UNFINISHED_SIGNUP';
  failedTries: number;
  lastTriedAt: string;
  name: string | null;
  whatsappNumber: string | null;
  hasAccount: boolean;
  leaderId: string | null;
  personId: string | null;
}

const PERIODS = [7, 30, 90, 365];

export function SignInTroubleTab() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(30);
  const [items, setItems] = useState<TroubleItem[] | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [helping, setHelping] = useState<TroubleItem | null>(null);

  useEffect(() => {
    setItems(null);
    setError(false);
    setCopied(false);
    api
      .get<{ items: TroubleItem[] }>(`/api/admin/sign-in-trouble?days=${days}`)
      .then((res) => setItems(res.items))
      .catch(() => setError(true));
  }, [days]);

  async function copyAll() {
    if (!items) return;
    try {
      await navigator.clipboard.writeText([...new Set(items.map((i) => i.email))].join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // The person's own link when they're in People; otherwise the leader's.
  const helpEndpoint = (item: TroubleItem) =>
    item.personId ? `/api/admin/people/${item.personId}/sign-in-help` : `/api/admin/leaders/${item.leaderId}/sign-in-help`;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold text-brand-900">{t('admin.signInTrouble.title')}</h2>
        <p className="text-sm text-slate-500">{t('admin.signInTrouble.intro')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">{t('admin.signInTrouble.period')}</span>
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-sm ${d === days ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {t('admin.signInTrouble.days', { count: d })}
            </button>
          ))}
        </div>
        {items && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-slate-700">{t('admin.signInTrouble.count', { count: items.length })}</p>
            <button type="button" className="btn-secondary px-3 py-1.5" onClick={copyAll}>
              {copied ? t('admin.signInTrouble.copied') : t('admin.signInTrouble.copy_all')}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{t('admin.signInTrouble.failed')}</p>}
      {!items && !error && <p className="text-sm text-slate-500">{t('admin.signInTrouble.loading')}</p>}
      {items && items.length === 0 && <p className="card text-sm text-slate-500">{t('admin.signInTrouble.none')}</p>}

      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const fix = suggestEmailFix(item.email);
            return (
              <li key={`${item.kind}:${item.email}`} className="card space-y-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-medium text-slate-900">{item.email}</p>
                    {item.name && <p className="text-sm text-slate-600">{item.name}</p>}
                  </div>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {t(`admin.signInTrouble.kind.${item.kind}`)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {t('admin.signInTrouble.last_tried', { when: when(item.lastTriedAt) })}
                  {item.failedTries > 0 && ` · ${t('admin.signInTrouble.tries', { count: item.failedTries })}`}
                </p>
                {fix && <p className="text-sm text-amber-800">{t('admin.signInTrouble.typo', { fix })}</p>}
                {!item.hasAccount && item.kind !== 'UNFINISHED_SIGNUP' && (
                  <p className="text-sm text-slate-600">{t('admin.signInTrouble.no_account')}</p>
                )}
                {item.kind === 'UNFINISHED_SIGNUP' && <p className="text-sm text-slate-600">{t('admin.signInTrouble.unfinished_hint')}</p>}
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {(item.personId || item.leaderId) && (
                    <button type="button" className="font-medium text-brand-700 underline" onClick={() => setHelping(item)}>
                      {t('admin.people.signInHelp.title')}
                    </button>
                  )}
                  {item.whatsappNumber && (
                    <a className="text-brand-700 underline" href={`https://wa.me/${item.whatsappNumber.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                      {t('admin.signInTrouble.whatsapp')}
                    </a>
                  )}
                  <a className="text-brand-700 underline" href={`mailto:${fix ?? item.email}`}>
                    {t('admin.signInTrouble.email')}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {helping && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.leaders.help_title', { name: helping.name ?? helping.email }) ?? ''}
            className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:rounded-2xl"
          >
            <h3 className="font-semibold text-brand-900">{t('admin.leaders.help_title', { name: helping.name ?? helping.email })}</h3>
            <SignInHelpPanel key={helping.email} endpoint={helpEndpoint(helping)} />
            <button type="button" className="btn-secondary w-full" onClick={() => setHelping(null)}>
              {t('admin.leaders.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
