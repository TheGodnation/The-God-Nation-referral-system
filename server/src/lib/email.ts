import { Resend } from 'resend';
import { prisma } from './prisma';

// Section 35: Resend is configured purely through a server-side env var,
// exactly like DATABASE_URL — never exposed to the client, never hardcoded.
// EMAIL_FROM must be a sender the Resend account can actually send from; we
// never invent one. Without a verified custom domain, Resend only allows
// sending from its own sandbox address (onboarding@resend.dev), which is
// itself a real, Resend-provided sender — not something we made up — but it
// only reliably delivers to the Resend account's own verified address until
// a custom domain is added.
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'The God Nation <onboarding@resend.dev>';

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

interface SendResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
}

async function send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  if (!resend) {
    // Never block the caller (registration, leader creation, etc.) just
    // because email isn't configured — log and move on.
    console.warn('[email] RESEND_API_KEY not configured — email not sent', { to, subject });
    return { ok: false, skipped: true };
  }
  try {
    const result = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
    if (result.error) {
      console.error('[email] Resend rejected the send', { to, subject, error: result.error.message });
      return { ok: false };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error('[email] send threw', { to, subject, error: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Admin-editable email text (Admin Settings > Content > Emails). Every
// template below has a built-in default; an Admin only needs to touch this
// if they want different wording. `{{placeholders}}` inside a template are
// substituted with real values at send time — HTML output escapes the
// Admin's own text (so a stray "<" or "&" they typed never breaks the
// email) and then drops in the placeholder value, which for a link is
// already a safe, server-generated URL rendered as a clickable anchor.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  registrationConfirmationSubjectEn: 'Your registration is confirmed',
  registrationConfirmationSubjectFr: 'Votre inscription est confirmée',
  registrationConfirmationBodyEn:
    'Hi {{name}},\n\nThank you for registering with The God Nation. Join our WhatsApp Community here: {{link}}',
  registrationConfirmationBodyFr:
    'Bonjour {{name}},\n\nMerci pour votre inscription auprès de The God Nation. Rejoignez notre Communauté WhatsApp ici : {{link}}',

  whatsappReminderSubjectEn: "Don't forget to join our WhatsApp community!",
  whatsappReminderSubjectFr: 'N’oubliez pas de rejoindre notre communauté WhatsApp !',
  whatsappReminderBodyEn:
    "Hi {{name}},\n\nWe noticed you haven't joined our WhatsApp community yet. Tap here to join now: {{link}}",
  whatsappReminderBodyFr:
    'Bonjour {{name}},\n\nNous avons remarqué que vous n’avez pas encore rejoint notre communauté WhatsApp. Cliquez ici pour la rejoindre maintenant : {{link}}',

  leaderInvitationSubject: 'You are invited to lead on The God Nation',
  leaderInvitationBody:
    "Hi {{name}},\n\nYou've been added as a Leader on The God Nation Referral System. Set your password to activate your account and get your referral link:\n{{setupUrl}}\n\nThis link expires in 7 days and can only be used once.\n\n— The God Nation Media & Leadership Academy",

  passwordResetSubject: 'Reset your password',
  passwordResetBody:
    'We received a request to reset your password.\n{{resetUrl}}\n\nThis link expires in 1 hour and can only be used once. If you did not request this, you can safely ignore this email.',
};

async function getEmailContent(): Promise<Record<string, string>> {
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  return (settings?.content as Record<string, string> | null) ?? {};
}

/** Admin-authored template text, escaped for HTML, then `{{name}}`-style
 * placeholders swapped in. Placeholder values are pre-rendered, already-safe
 * HTML (e.g. an `<a href>` for a link) and are inserted after escaping, so
 * they render as intended rather than as literal text. */
function renderHtml(template: string, vars: Record<string, string>): string {
  let html = escapeHtml(template).replace(/\n/g, '<br/>');
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  return `<p>${html}</p>`;
}

function renderText(template: string, vars: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(`{{${key}}}`).join(value);
  }
  return text;
}

function linkHtml(url: string): string {
  return `<a href="${url}">${url}</a>`;
}

export const EmailService = {
  /** Section 37: new Leader onboarding — a one-time setup link, never a password. */
  async sendLeaderInvitation(params: { to: string; name: string; setupUrl: string }): Promise<SendResult> {
    const content = await getEmailContent();
    const subject = content.emailLeaderInvitationSubject || DEFAULTS.leaderInvitationSubject;
    const bodyTemplate = content.emailLeaderInvitationBody || DEFAULTS.leaderInvitationBody;
    const htmlVars = { name: escapeHtml(params.name), setupUrl: linkHtml(params.setupUrl) };
    const textVars = { name: params.name, setupUrl: params.setupUrl };
    return send(params.to, subject, renderHtml(bodyTemplate, htmlVars), renderText(bodyTemplate, textVars));
  },

  /** Section 36: optional registration confirmation — includes the WhatsApp
   * join link directly, so joining no longer depends on the visitor
   * returning to the confirmation page. */
  async sendRegistrationConfirmation(params: {
    to: string;
    name: string;
    language: 'en' | 'fr';
    link: string;
  }): Promise<SendResult> {
    const content = await getEmailContent();
    const isFr = params.language === 'fr';
    const subject = isFr
      ? content.emailRegistrationConfirmationSubjectFr || DEFAULTS.registrationConfirmationSubjectFr
      : content.emailRegistrationConfirmationSubjectEn || DEFAULTS.registrationConfirmationSubjectEn;
    const bodyTemplate = isFr
      ? content.emailRegistrationConfirmationBodyFr || DEFAULTS.registrationConfirmationBodyFr
      : content.emailRegistrationConfirmationBodyEn || DEFAULTS.registrationConfirmationBodyEn;
    const htmlVars = { name: escapeHtml(params.name), link: linkHtml(params.link) };
    const textVars = { name: params.name, link: params.link };
    return send(params.to, subject, renderHtml(bodyTemplate, htmlVars), renderText(bodyTemplate, textVars));
  },

  /** Admin-triggered reminder for registrants who haven't clicked the
   * WhatsApp join link yet (see /api/admin/whatsapp-reminders). */
  async sendWhatsAppReminder(params: {
    to: string;
    name: string;
    language: 'en' | 'fr';
    link: string;
  }): Promise<SendResult> {
    const content = await getEmailContent();
    const isFr = params.language === 'fr';
    const subject = isFr
      ? content.emailWhatsappReminderSubjectFr || DEFAULTS.whatsappReminderSubjectFr
      : content.emailWhatsappReminderSubjectEn || DEFAULTS.whatsappReminderSubjectEn;
    const bodyTemplate = isFr
      ? content.emailWhatsappReminderBodyFr || DEFAULTS.whatsappReminderBodyFr
      : content.emailWhatsappReminderBodyEn || DEFAULTS.whatsappReminderBodyEn;
    const htmlVars = { name: escapeHtml(params.name), link: linkHtml(params.link) };
    const textVars = { name: params.name, link: params.link };
    return send(params.to, subject, renderHtml(bodyTemplate, htmlVars), renderText(bodyTemplate, textVars));
  },

  /** Section 33/38: password reset. */
  async sendPasswordReset(params: { to: string; resetUrl: string }): Promise<SendResult> {
    const content = await getEmailContent();
    const subject = content.emailPasswordResetSubject || DEFAULTS.passwordResetSubject;
    const bodyTemplate = content.emailPasswordResetBody || DEFAULTS.passwordResetBody;
    const htmlVars = { resetUrl: linkHtml(params.resetUrl) };
    const textVars = { resetUrl: params.resetUrl };
    return send(params.to, subject, renderHtml(bodyTemplate, htmlVars), renderText(bodyTemplate, textVars));
  },
};
