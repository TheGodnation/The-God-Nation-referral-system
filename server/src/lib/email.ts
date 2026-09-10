import { Resend } from 'resend';

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

export const EmailService = {
  /** Section 37: new Leader onboarding — a one-time setup link, never a password. */
  async sendLeaderInvitation(params: { to: string; name: string; setupUrl: string }): Promise<SendResult> {
    const safeName = escapeHtml(params.name);
    const subject = 'You are invited to lead on The God Nation';
    const html = `
      <p>Hi ${safeName},</p>
      <p>You've been added as a Leader on The God Nation Referral System. Set your password to activate your account and get your referral link:</p>
      <p><a href="${params.setupUrl}">${params.setupUrl}</a></p>
      <p>This link expires in 7 days and can only be used once.</p>
      <p>— The God Nation Media &amp; Leadership Academy</p>
    `;
    const text = `Hi ${params.name},\n\nYou've been added as a Leader on The God Nation Referral System. Set your password here:\n${params.setupUrl}\n\nThis link expires in 7 days and can only be used once.`;
    return send(params.to, subject, html, text);
  },

  /** Section 36: optional registration confirmation. */
  async sendRegistrationConfirmation(params: { to: string; name: string; language: 'en' | 'fr' }): Promise<SendResult> {
    const safeName = escapeHtml(params.name);
    const isFr = params.language === 'fr';
    const subject = isFr ? 'Votre inscription est confirmée' : 'Your registration is confirmed';
    const body = isFr
      ? `Bonjour ${safeName},<br/><br/>Merci pour votre inscription auprès de The God Nation. Vous pouvez maintenant rejoindre notre Communauté WhatsApp depuis la page de confirmation.`
      : `Hi ${safeName},<br/><br/>Thank you for registering with The God Nation. You can now join our WhatsApp Community from the confirmation page.`;
    const text = isFr
      ? `Bonjour ${params.name},\n\nMerci pour votre inscription auprès de The God Nation.`
      : `Hi ${params.name},\n\nThank you for registering with The God Nation.`;
    return send(params.to, subject, `<p>${body}</p>`, text);
  },

  /** Section 33/38: password reset. */
  async sendPasswordReset(params: { to: string; resetUrl: string }): Promise<SendResult> {
    const subject = 'Reset your password';
    const html = `
      <p>We received a request to reset your password.</p>
      <p><a href="${params.resetUrl}">${params.resetUrl}</a></p>
      <p>This link expires in 1 hour and can only be used once. If you did not request this, you can safely ignore this email.</p>
    `;
    const text = `We received a request to reset your password:\n${params.resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you did not request this, you can safely ignore this email.`;
    return send(params.to, subject, html, text);
  },
};
