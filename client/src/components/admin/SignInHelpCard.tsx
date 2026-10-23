import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// "Help them sign in" (Admin → People → a person). For someone who forgot
// their password and can't get the emailed codes: a private link that works
// once, for 24 hours, sent to them on WhatsApp. They choose the new password
// themselves — the admin never sees it. See POST /people/:id/sign-in-help.

interface Props {
  person: {
    id: string;
    name: string;
    preferredLanguage: string;
    users: { role: string }[];
    memberAccount: { email: string } | null;
  };
}

interface HelpLink {
  url: string;
  expiresAt: string;
  kind: 'MEMBER' | 'LEADER';
  name: string;
  /** null for a leader not linked to anyone in People: WhatsApp then asks whom to send it to. */
  whatsappNumber: string | null;
  language: string | null;
  /** Leaders list only: the email they sign in with on the leader page. */
  email?: string;
}

export function SignInHelpCard({ person }: Props) {
  const { t } = useTranslation();
  const isCentralAdmin = person.users.some((u) => u.role === 'ADMIN');
  const hasAccount = Boolean(person.memberAccount) || person.users.some((u) => u.role === 'LEADER');

  return (
    <div className="card mt-4 space-y-3">
      <h2 className="font-semibold text-brand-900">{t('admin.people.signInHelp.title')}</h2>
      {isCentralAdmin ? (
        <p className="text-sm text-slate-400">{t('admin.people.signInHelp.central_admin')}</p>
      ) : !hasAccount ? (
        <p className="text-sm text-slate-400">{t('admin.people.signInHelp.no_account')}</p>
      ) : (
        <SignInHelpPanel endpoint={`/api/admin/people/${person.id}/sign-in-help`} />
      )}
    </div>
  );
}

/** The "make a link → send on WhatsApp / copy" part, shared by People and Leaders. */
export function SignInHelpPanel({ endpoint }: { endpoint: string }) {
  const { t, i18n } = useTranslation();
  const [link, setLink] = useState<HelpLink | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  async function make() {
    if (making) return;
    setMaking(true);
    setError(null);
    setCopied(false);
    setOpened(false);
    try {
      setLink(await api.post<HelpLink>(endpoint, {}));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.people.signInHelp.failed'));
    } finally {
      setMaking(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // The WhatsApp message is written in the person's own language (the
  // admin's, when it isn't known).
  const lng = (link?.language ?? i18n.language).startsWith('fr') ? 'fr' : 'en';
  const until = link
    ? new Date(link.expiresAt).toLocaleString(lng === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : '';
  const message = link
    ? t(link.kind === 'LEADER' && link.email ? 'admin.people.signInHelp.whatsapp_message_leader' : 'admin.people.signInHelp.whatsapp_message', {
        lng,
        name: link.name,
        url: link.url,
        until,
        email: link.email,
      })
    : '';
  const digits = link?.whatsappNumber?.replace(/\D/g, '') ?? '';
  const whatsappHref = link ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : '';

  return (
    <>
      <p className="text-xs text-slate-500">{t('admin.people.signInHelp.hint')}</p>
      {link ? (
        <div className="space-y-2 rounded-lg bg-brand-50 p-3">
          <p role="status" className="text-sm font-semibold text-brand-900">
            {opened ? t('admin.people.signInHelp.whatsapp_opened') : t('admin.people.signInHelp.step_send')}
          </p>
          <p className="break-all text-sm text-slate-700" data-testid="sign-in-help-url">{link.url}</p>
          <p className="text-xs text-slate-500">{t('admin.people.signInHelp.expires', { until })}</p>
          {link.kind === 'LEADER' && link.email && (
            <p className="text-xs text-slate-500">{t('admin.people.signInHelp.leader_signs_in', { email: link.email })}</p>
          )}
          {!digits && <p className="text-xs text-slate-500">{t('admin.people.signInHelp.no_number')}</p>}
          <div className="flex flex-wrap gap-2">
            <a className="btn-primary px-3 py-1.5" href={whatsappHref} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
              {t('admin.people.signInHelp.send_whatsapp')}
            </a>
            <button type="button" className="btn-secondary px-3 py-1.5" onClick={copy}>
              {copied ? t('admin.people.signInHelp.copied') : t('admin.people.signInHelp.copy')}
            </button>
            <button type="button" className="px-3 py-1.5 text-sm text-slate-500 underline" onClick={make} disabled={making}>
              {t('admin.people.signInHelp.new_link')}
            </button>
          </div>
          <p className="text-xs text-slate-500">{t('admin.people.signInHelp.only_once')}</p>
        </div>
      ) : (
        <button type="button" className="btn-primary px-3 py-1.5" onClick={make} disabled={making}>
          {making ? t('admin.people.signInHelp.making') : t('admin.people.signInHelp.make')}
        </button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </>
  );
}
