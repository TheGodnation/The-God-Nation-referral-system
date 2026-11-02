import { vi } from 'vitest';
import { EmailService } from '../lib/email';

/**
 * Joins the way the app does today: sign up with email + phone + password,
 * open the emailed link, then fill in the details form. Attribution is read
 * at sign-up, so a referral link must be visited (on the same agent) first.
 */
export async function joinAsNewMember(
  agent: any,
  csrf: string,
  opts: { email: string; whatsapp: string; password?: string; language?: 'en' | 'fr'; details: Record<string, unknown> },
) {
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const signup = await agent
    .post('/api/member/auth/signup')
    .set('X-CSRF-Token', csrf)
    .send({ email: opts.email, whatsapp: opts.whatsapp, password: opts.password ?? 'Testpass123', language: opts.language ?? 'en' });
  const link = spy.mock.calls[0]?.[0]?.link as string | undefined;
  spy.mockRestore();
  if (!link) return { signup, consume: null, done: signup };
  const token = new URL(link).searchParams.get('token');
  const consume = await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token });
  const done = await agent.post('/api/member/auth/complete-profile').set('X-CSRF-Token', csrf).send(opts.details);
  return { signup, consume, done };
}
