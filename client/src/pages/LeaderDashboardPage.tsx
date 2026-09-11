import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePublicSettings } from '../lib/usePublicSettings';

interface DashboardStats {
  whatsappClicks: number;
  conversionRate: number;
}

interface ReferralItem {
  name: string;
  whatsapp: string;
  language: string;
  registeredAt: string;
  status: string;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
    </div>
  );
}

// Section 24-26: additive "Invite People" panel. Every share/send action
// uses the Leader's own referral link only — never a client-suppliable
// Leader ID or code, and the server derives the link from the session.
//
// The shared message text is Admin-editable (Admin > Website Content >
// Leader Referral Message, key `leaderInviteMessage`) so it can be kept in
// sync with how the ministry is actually framing itself — falls back to
// the app's own built-in default when Admin hasn't set one. Wherever the
// Admin's text contains the literal placeholder `{{link}}`, it's replaced
// with this Leader's real referral link for WhatsApp/native-share; for
// Telegram (whose own share dialog attaches the link separately via its
// `url` param), any line containing that placeholder is dropped instead,
// so the link never appears twice.
function InvitePeople({
  links,
  messageTemplate,
}: {
  links: { en: string; fr: string } | null;
  messageTemplate?: string;
}) {
  const { t } = useTranslation();
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  if (!links) return null;
  const primaryLink = links.en;

  const whatsappMessage = messageTemplate
    ? messageTemplate.replace(/\{\{link\}\}/g, primaryLink)
    : t('leader.invite_message', { link: primaryLink });
  const telegramMessage = messageTemplate
    ? messageTemplate
        .split('\n')
        .filter((line) => !line.includes('{{link}}'))
        .join('\n')
        .trim()
    : t('leader.invite_message_telegram');

  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;
  const messengerShareUrl = `https://www.facebook.com/dialog/send?link=${encodeURIComponent(primaryLink)}&app_id=0&redirect_uri=${encodeURIComponent(primaryLink)}`;
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(primaryLink)}&text=${encodeURIComponent(telegramMessage)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(primaryLink);
      setEmailStatus(t('leader.invite_link_copied'));
      setTimeout(() => setEmailStatus(null), 1500);
    } catch {
      // no-op
    }
  }

  async function webShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'The God Nation', text: whatsappMessage, url: primaryLink });
      } catch {
        // user cancelled — no-op
      }
    }
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('leader.invite_title')}</h2>
      <div className="flex flex-wrap gap-3">
        <a href={whatsappShareUrl} target="_blank" rel="noreferrer" className="btn-primary bg-green-600 hover:bg-green-700">
          {t('leader.share_whatsapp')}
        </a>
        <a href={messengerShareUrl} target="_blank" rel="noreferrer" className="btn-secondary">
          {t('leader.share_messenger')}
        </a>
        <a
          href={telegramShareUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary bg-sky-500 text-white hover:bg-sky-600"
        >
          {t('leader.share_telegram')}
        </a>
        <button type="button" onClick={copyLink} className="btn-secondary">
          {t('leader.copy_referral_link')}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" onClick={webShare} className="btn-secondary">
            {t('leader.share_generic')}
          </button>
        )}
      </div>
      {emailStatus && <p className="mt-2 text-sm text-slate-600">{emailStatus}</p>}
    </div>
  );
}

export function LeaderDashboardPage() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { content } = usePublicSettings();
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const messageTemplate = content[`leaderInviteMessage${lang}`] || undefined;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [links, setLinks] = useState<{ en: string; fr: string } | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [items, setItems] = useState<ReferralItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ referralCode: string | null; stats: DashboardStats }>('/api/leader/dashboard').then((res) => {
      setStats(res.stats);
      setReferralCode(res.referralCode);
    });
    api
      .get<{ referralCode: string | null; links: { en: string; fr: string } | null }>('/api/leader/links')
      .then((res) => setLinks(res.links));
  }, []);

  useEffect(() => {
    api
      .get<{ items: ReferralItem[]; pagination: { totalPages: number } }>(
        `/api/leader/referrals?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }, [page]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard API unavailable — no-op; the link is still selectable/visible.
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{t('leader.dashboard_title')}</h1>
            <p className="text-sm text-slate-500">{user?.name}</p>
          </div>
          <button onClick={() => logout()} className="btn-secondary">
            {t('leader.logout')}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label={t('leader.stat_referral_code')} value={referralCode ?? '—'} />
          <StatCard label={t('leader.stat_whatsapp_clicks')} value={stats?.whatsappClicks ?? '—'} />
          <StatCard label={t('leader.stat_conversion')} value={stats ? `${stats.conversionRate}%` : '—'} />
        </div>

        <div className="card mt-6">
          <h2 className="mb-3 font-semibold text-brand-900">{t('leader.links_title')}</h2>
          {links ? (
            <div className="space-y-3">
              {(['en', 'fr'] as const).map((lang) => (
                <div key={lang} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="w-10 text-sm font-medium uppercase text-slate-500">{lang}</span>
                  <input readOnly value={links[lang]} className="input flex-1 bg-slate-50 text-sm" />
                  <button className="btn-secondary sm:w-32" onClick={() => copy(links[lang], lang)}>
                    {copied === lang ? t('leader.copied') : t('leader.copy')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">{t('leader.no_referral_code')}</p>
          )}
        </div>

        <InvitePeople links={links} messageTemplate={messageTemplate} />

        <div className="card mt-6 overflow-x-auto">
          <h2 className="mb-3 font-semibold text-brand-900">{t('leader.referrals_title')}</h2>
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('leader.table_name')}</th>
                <th className="py-2 pr-4">{t('leader.table_whatsapp')}</th>
                <th className="py-2 pr-4">{t('leader.table_language')}</th>
                <th className="py-2 pr-4">{t('leader.table_registered')}</th>
                <th className="py-2 pr-4">{t('leader.table_status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, idx) => (
                <tr key={idx} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{r.whatsapp}</td>
                  <td className="py-2 pr-4 uppercase">{r.language}</td>
                  <td className="py-2 pr-4">{new Date(r.registeredAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    {t('leader.no_referrals')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('leader.prev')}
              </button>
              <span>{t('leader.page_of', { page, total: totalPages })}</span>
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('leader.next')}
              </button>
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
