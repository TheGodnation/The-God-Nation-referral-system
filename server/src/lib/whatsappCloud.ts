import { prisma } from './prisma';
import { currentConsent } from './contactConsent';
import { isCentralAdminPerson } from './centralAdmin';

// Automatic WhatsApp messages through Meta's WhatsApp Business Platform (Cloud API). Everything here is OFF until the central
// admin switches it on, and then it only ever messages people who agreed to WhatsApp messages (their recorded choice), using
// templates Meta has approved. A failure never stops anything else (the bell, the phone alert and the private message go out
// as before). The secret access token lives only in the server's environment (WHATSAPP_ACCESS_TOKEN), never in the database,
// and is never written to a log.

export type CloudMode = 'OFF' | 'TEST' | 'ON';
export type CloudKind = 'teaching_assignment' | 'teaching_tomorrow' | 'teaching_hour' | 'test';

const SEND_TIMEOUT_MS = 15_000;

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const accessToken = () => process.env.WHATSAPP_ACCESS_TOKEN || '';
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';

/** True when the access token and the sending number's id are both set in the server's environment. */
export function cloudConfigured(): boolean {
  return Boolean(accessToken() && phoneNumberId());
}

export async function cloudMode(): Promise<CloudMode> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { whatsappCloudMode: true } });
  return s?.whatsappCloudMode ?? 'OFF';
}

const CAMEROON_OFFSET_MS = 60 * 60 * 1000; // Cameroon is UTC+1 all year

/** The first moment of the calendar month that `now` falls in, in Cameroon time (as a real instant). */
export function cameroonMonthStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + CAMEROON_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - CAMEROON_OFFSET_MS);
}

/** The first moment of the next month, in Cameroon time: when the monthly count starts again. */
export function cameroonNextMonthStart(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + CAMEROON_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - CAMEROON_OFFSET_MS);
}

/** The most automatic messages that may go out this month (set by the central admin). */
export async function monthlyLimit(): Promise<number> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { whatsappMonthlyLimit: true } });
  return s?.whatsappMonthlyLimit ?? 300;
}

/** How many automatic messages have gone out this month. The test message is free, so it is not counted. */
export function sentThisMonth(now: Date = new Date()): Promise<number> {
  return prisma.whatsAppCloudSend.count({ where: { status: 'SENT', kind: { not: 'test' }, createdAt: { gte: cameroonMonthStart(now) } } });
}

/** WhatsApp wants the number with the country code and digits only (no "+"). */
export const toCloudNumber = (e164: string) => e164.replace(/[^\d]/g, '');

/** The template for a kind (the names are the ones created in Meta's message templates, one per language). */
const TEMPLATE: Record<CloudKind, string> = {
  teaching_assignment: 'teaching_assignment',
  teaching_tomorrow: 'teaching_tomorrow',
  teaching_hour: 'teaching_hour',
  test: 'hello_world',
};

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

/** One template message to one number. Never throws. */
export async function sendTemplate(input: { to: string; template: string; language: string; params?: string[] }): Promise<SendResult> {
  if (!cloudConfigured()) return { ok: false, error: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://graph.facebook.com/${apiVersion()}/${phoneNumberId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toCloudNumber(input.to),
        type: 'template',
        template: {
          name: input.template,
          language: { code: input.language },
          ...(input.params && input.params.length ? { components: [{ type: 'body', parameters: input.params.map((text) => ({ type: 'text', text })) }] } : {}),
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) return { ok: false, error: `${data.error?.code ?? res.status}: ${data.error?.message ?? 'rejected'}`.slice(0, 300) };
    return { ok: true, messageId: data.messages?.[0]?.id ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'could not reach WhatsApp' };
  } finally {
    clearTimeout(timer);
  }
}

async function record(row: { personId?: string | null; to: string; kind: CloudKind; template: string; language: string; status: 'SENT' | 'FAILED' | 'SKIPPED'; reason?: string; messageId?: string }) {
  await prisma.whatsAppCloudSend.create({
    data: { personId: row.personId ?? null, toNumber: row.to, kind: row.kind, template: row.template, language: row.language, status: row.status, reason: row.reason ?? null, messageId: row.messageId || null },
  });
}

/**
 * Sends one automatic WhatsApp message to a member, if every rule allows it: the switch is on (TEST: only the central admin's own
 * number), Meta's sending is set up, and the person agreed to WhatsApp messages. What was sent, or held back and why, is recorded.
 * Never throws.
 */
export async function whatsappCloudNotify(personId: string, kind: Exclude<CloudKind, 'test'>, vars: { topic: string; when?: string }): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const mode = await cloudMode();
    if (mode === 'OFF') return 'skipped';
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { name: true, whatsappNumber: true, preferredLanguage: true, erasedAt: true } });
    if (!person || person.erasedAt || !person.whatsappNumber) return 'skipped';
    const language = String(person.preferredLanguage).startsWith('fr') ? 'fr' : 'en';
    const template = TEMPLATE[kind];
    const held = async (reason: string) => {
      await record({ personId, to: person.whatsappNumber, kind, template, language, status: 'SKIPPED', reason });
      return 'skipped' as const;
    };
    if (!cloudConfigured()) return held('Meta sending is not set up yet');
    if (mode === 'TEST' && !(await isCentralAdminPerson(personId))) return held('test mode: only the central admin is messaged');
    if ((await currentConsent(prisma, personId)).whatsapp !== true) return held('did not agree to WhatsApp messages');
    // Every delivered message is paid for: once this month's limit is reached the rest wait (recorded) until the 1st.
    if ((await sentThisMonth()) >= (await monthlyLimit())) return held('monthly limit reached');
    const firstName = person.name.split(/\s+/)[0] || person.name;
    const params = kind === 'teaching_hour' ? [firstName, vars.topic] : [firstName, vars.topic, vars.when ?? ''];
    const result = await sendTemplate({ to: person.whatsappNumber, template, language, params });
    if (result.ok) {
      await record({ personId, to: person.whatsappNumber, kind, template, language, status: 'SENT', messageId: result.messageId });
      return 'sent';
    }
    await record({ personId, to: person.whatsappNumber, kind, template, language, status: 'FAILED', reason: result.error });
    return 'failed';
  } catch (err) {
    console.error('[whatsapp-cloud] could not send', { error: err instanceof Error ? err.message : String(err) });
    return 'failed';
  }
}

/** The central admin's "send a test message": Meta's sample message ("hello_world") to one number, which must be on the test list. */
export async function sendTestMessage(to: string, personId?: string | null): Promise<SendResult> {
  const result = await sendTemplate({ to, template: TEMPLATE.test, language: 'en_US' });
  await record({ personId: personId ?? null, to, kind: 'test', template: TEMPLATE.test, language: 'en_US', status: result.ok ? 'SENT' : 'FAILED', reason: result.ok ? undefined : result.error, messageId: result.ok ? result.messageId : undefined });
  return result;
}
