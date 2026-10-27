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
    email?: string | null;
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
  // Not signed up yet (for instance cannot open their email): the admin opens the account here.

  return (
    <div className="card mt-4 space-y-3">
      <h2 className="font-semibold text-brand-900">{t('admin.people.signInHelp.title')}</h2>
      {isCentralAdmin ? (
        <p className="text-sm text-slate-400">{t('admin.people.signInHelp.central_admin')}</p>
      ) : (
        <SignInHelpPanel endpoint={`/api/admin/people/${person.id}/sign-in-help`} askEmail={hasAccount ? undefined : (person.email ?? '')} />
      )}
    </div>
  );
}

/** The "make a link → send on WhatsApp / copy" part, shared by People and Leaders. */
export function SignInHelpPanel({ endpoint, askEmail }: { endpoint: string; askEmail?: string }) {
  const { t, i18n } = useTranslation();
  const [link, setLink] = useState<HelpLink | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [newEmail, setNewEmail] = useState(askEmail ?? '');
  const [chosenLng, setChosenLng] = useState<'en' | 'fr' | null>(null);

  async function make() {
    if (making) return;
    setMaking(true);
    setError(null);
    setCopied(false);
    setOpened(false);
    try {
      setLink(await api.post<HelpLink>(endpoint, askEmail === undefined ? {} : { email: newEmail }));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === 'EMAIL_TAKEN' ? t('admin.people.signInHelp.email_taken') : code === 'EMAIL_NEEDED' ? t('admin.people.signInHelp.email_needed') : err instanceof ApiError ? err.message : t('admin.people.signInHelp.failed'),
      );
    } finally {
      setMaking(false);
    }
  }

  async function copy() {
    if (!link || !shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // The WhatsApp message is written in the person's own language (the
  // admin's, when it isn't known).
  const lng: 'en' | 'fr' = chosenLng ?? ((link?.language ?? i18n.language).startsWith('fr') ? 'fr' : 'en');
  // The link opens the page in that same language (?lang=), whatever the phone's own language is.
  const shareUrl = link ? `${link.url}${link.url.includes('?') ? '&' : '?'}lang=${lng}` : '';
  const until = link
    ? new Date(link.expiresAt).toLocaleString(lng === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : '';
  const message = link
    ? t(link.kind === 'LEADER' && link.email ? 'admin.people.signInHelp.whatsapp_message_leader' : 'admin.people.signInHelp.whatsapp_message', {
        lng,
        name: link.name,
        url: shareUrl,
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
          <p className="break-all text-sm text-slate-700" data-testid="sign-in-help-url">{shareUrl}</p>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>{t('admin.people.signInHelp.language_label')}</span>
            {(['en', 'fr'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lng === l}
                onClick={() => setChosenLng(l)}
                className={`rounded-md border px-2 py-0.5 font-medium ${lng === l ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {l === 'en' ? 'English' : 'Français'}
              </button>
            ))}
          </div>
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
        <div className="space-y-2">
          {askEmail !== undefined && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">{t('admin.people.signInHelp.new_account_hint')}</p>
              <label className="label" htmlFor="new-account-email">
                {t('admin.people.signInHelp.new_account_email')}
              </label>
              <input id="new-account-email" type="email" className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="off" />
            </div>
          )}
          <button type="button" className="btn-primary px-3 py-1.5" onClick={make} disabled={making || (askEmail !== undefined && !newEmail.trim())}>
            {making ? t('admin.people.signInHelp.making') : askEmail !== undefined ? t('admin.people.signInHelp.make_new_account') : t('admin.people.signInHelp.make')}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </>
  );
}
