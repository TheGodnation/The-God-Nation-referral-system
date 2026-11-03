import { createHash, randomUUID } from 'crypto';
import { prisma } from './prisma';
import { currentConsent } from './contactConsent';

// Server-side conversion events to the ad platforms (Meta "Conversions API",
// TikTok "Events API"). They tell the platform "this ad click became a sign-up"
// even when the person's browser blocks the pixel.
//
// Rules, all enforced here and nowhere else:
//  - Nothing is sent unless the person ticked the ADS consent (latest choice).
//  - Nothing is sent to a platform unless its pixel id is set in Settings AND
//    its secret access token is set as a server environment variable.
//  - Meta gets an event only if the person arrived from a Meta ad (fbclid) or
//    has a Meta browser cookie (fbp); TikTok only if they arrived with a ttclid.
//  - Email and phone are SHA-256 hashed before they leave the server.
//  - Sending is best effort and never delays or fails the member's request;
//    every attempt is written to AdEventLog so the admin can see what happened.
//
// NOT yet verified against the live platforms: the first real test must use the
// platforms' "test events" tools (set META_TEST_EVENT_CODE / TIKTOK_TEST_EVENT_CODE).

export type AdEventName = 'Lead' | 'CompleteRegistration';

const META_VERSION = 'v21.0';
const TIMEOUT_MS = 8000;

/** Platform names as stored in AdEventLog.platform. */
export const AD_PLATFORMS = ['meta', 'tiktok'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const FBP_VALUE = /^fb\.\d\.\d{10,15}\.\d{5,20}$/;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Lower-case and trim, as both platforms require before hashing. */
export function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

/** Digits only (country code included, no "+"), as Meta requires. */
export function hashPhoneDigits(phone: string): string {
  return sha256(phone.replace(/\D/g, ''));
}

/** E.164 with a leading "+", as TikTok asks. */
export function hashPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return sha256(`+${digits}`);
}

export interface AdEventInput {
  personId: string;
  event: AdEventName;
  /** Same id the browser pixel used for this event, so the platform counts it once. */
  eventId?: string | null;
  email: string | null;
  phone: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  sourceUrl: string;
  /** When the ad click happened (or the closest moment we know). */
  clickedAt?: Date | null;
  at?: Date;
}

export function buildMetaPayload(i: AdEventInput, eventId: string, testCode?: string | null) {
  const userData: Record<string, unknown> = { external_id: [sha256(i.personId)] };
  if (i.email) userData.em = [hashEmail(i.email)];
  if (i.phone) userData.ph = [hashPhoneDigits(i.phone)];
  if (i.ip) userData.client_ip_address = i.ip;
  if (i.userAgent) userData.client_user_agent = i.userAgent;
  if (i.fbclid) userData.fbc = `fb.1.${(i.clickedAt ?? i.at ?? new Date()).getTime()}.${i.fbclid}`;
  if (i.fbp && FBP_VALUE.test(i.fbp)) userData.fbp = i.fbp;
  return {
    data: [{
      event_name: i.event,
      event_time: Math.floor((i.at ?? new Date()).getTime() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: i.sourceUrl,
      user_data: userData,
    }],
    ...(testCode ? { test_event_code: testCode } : {}),
  };
}

/** TikTok's name for each event (their "SubmitForm" is the form-lead event). */
export const TIKTOK_EVENT_NAMES: Record<AdEventName, string> = { Lead: 'SubmitForm', CompleteRegistration: 'CompleteRegistration' };

export function buildTikTokPayload(i: AdEventInput, eventId: string, pixelCode: string, testCode?: string | null) {
  const user: Record<string, unknown> = { external_id: sha256(i.personId) };
  if (i.email) user.email = hashEmail(i.email);
  if (i.phone) user.phone_number = hashPhoneE164(i.phone);
  if (i.ip) user.ip = i.ip;
  if (i.userAgent) user.user_agent = i.userAgent;
  if (i.ttclid) user.ttclid = i.ttclid;
  return {
    event_source: 'web',
    event_source_id: pixelCode,
    ...(testCode ? { test_event_code: testCode } : {}),
    data: [{
      event: TIKTOK_EVENT_NAMES[i.event],
      event_time: Math.floor((i.at ?? new Date()).getTime() / 1000),
      event_id: eventId,
      user,
      page: { url: i.sourceUrl },
    }],
  };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 2000) };
  } finally {
    clearTimeout(timer);
  }
}

async function log(personId: string, platform: AdPlatform, event: AdEventName, eventId: string, ok: boolean, status: number | null, error: string | null) {
  try {
    await prisma.adEventLog.create({ data: { personId, platform, event, eventId, ok, status, error: error ? error.slice(0, 300) : null } });
  } catch (err) {
    console.warn('[ads] could not write the event log', (err as Error).message);
  }
}

/** Which platforms are switched on (pixel id in Settings and token in the environment). */
export function platformsReady(s: { metaPixelId: string | null; tiktokPixelId: string | null }) {
  return {
    meta: Boolean(s.metaPixelId && process.env.META_CAPI_TOKEN),
    tiktok: Boolean(s.tiktokPixelId && process.env.TIKTOK_EVENTS_TOKEN),
  };
}

/**
 * Sends one event to every platform that is ready and that the person qualifies
 * for. Never throws. Returns the platforms it attempted (for tests and logs).
 */
export async function sendAdEvent(input: AdEventInput): Promise<AdPlatform[]> {
  const attempted: AdPlatform[] = [];
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { metaPixelId: true, tiktokPixelId: true } });
    if (!settings) return attempted;
    const ready = platformsReady(settings);
    if (!ready.meta && !ready.tiktok) return attempted;
    if ((await currentConsent(prisma, input.personId)).ads !== true) return attempted;

    const eventId = input.eventId && AD_EVENT_ID.test(input.eventId) ? input.eventId : randomUUID();

    if (ready.meta && (input.fbclid || input.fbp)) {
      attempted.push('meta');
      try {
        const url = `https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(settings.metaPixelId!)}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN!)}`;
        const r = await post(url, {}, buildMetaPayload(input, eventId, process.env.META_TEST_EVENT_CODE));
        await log(input.personId, 'meta', input.event, eventId, r.ok, r.status, r.ok ? null : r.text);
      } catch (err) {
        await log(input.personId, 'meta', input.event, eventId, false, null, (err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message);
      }
    }

    if (ready.tiktok && input.ttclid) {
      attempted.push('tiktok');
      try {
        const r = await post(
          'https://business-api.tiktok.com/open_api/v1.3/event/track/',
          { 'Access-Token': process.env.TIKTOK_EVENTS_TOKEN! },
          buildTikTokPayload(input, eventId, settings.tiktokPixelId!, process.env.TIKTOK_TEST_EVENT_CODE),
        );
        // TikTok answers 200 even for refusals; the real result is "code": 0.
        let code: number | null = null;
        try { code = (JSON.parse(r.text) as { code?: number }).code ?? null; } catch { /* not JSON */ }
        const ok = r.ok && code === 0;
        await log(input.personId, 'tiktok', input.event, eventId, ok, r.status, ok ? null : r.text);
      } catch (err) {
        await log(input.personId, 'tiktok', input.event, eventId, false, null, (err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[ads] event not sent', (err as Error).message);
  }
  return attempted;
}

/** Fire and forget, for use inside request handlers. */
export function sendAdEventInBackground(input: AdEventInput): void {
  void sendAdEvent(input);
}
