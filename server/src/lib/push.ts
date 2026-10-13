import webpush from 'web-push';
import { prisma } from './prisma';

// Web Push — background/closed-app delivery. This is an enhancement layer
// on top of the existing in-app Notification table, never a replacement
// for it: every call here is best-effort and must never throw into (or
// slow down) the request that triggered it, and the app must behave
// identically whether or not VAPID keys are configured.
//
// Configuration (Render env vars, generated once with `npx web-push
// generate-vapid-keys` or the `webpush.generateVAPIDKeys()` helper):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT ("mailto:someone@…")
// With no keys set, push sending silently no-ops — subscribing still
// "succeeds" from the client's point of view (the browser subscription is
// real), but no message is ever delivered. isPushConfigured() lets routes
// report this honestly instead of pretending push works.

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@thegodnationacademy.org';

const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function isPushConfigured(): boolean {
  return configured;
}

export function vapidPublicKey(): string | null {
  return configured ? VAPID_PUBLIC_KEY : null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App-relative path the client opens on notificationclick, e.g. "/member/chats". */
  url?: string;
}

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendToSubscription(sub: SubscriptionRow, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
  } catch (err: any) {
    // 404/410: the push service has permanently invalidated this
    // subscription (browser uninstalled, permission revoked, endpoint
    // expired) — clean it up. Any other status is transient (network,
    // quota, a momentary service outage) and left alone for the next try.
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

async function pushToWhere(where: { personId?: string; personId_in?: string[]; userId?: string }, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const subs = await prisma.pushSubscription.findMany({
    where: where.personId_in ? { personId: { in: where.personId_in } } : where.personId ? { personId: where.personId } : { userId: where.userId },
  });
  await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
}

/** Best-effort push to every device a Person has subscribed from. */
export async function pushToPerson(personId: string, payload: PushPayload): Promise<void> {
  return pushToWhere({ personId }, payload);
}

/** Best-effort push to every device an admin User has subscribed from. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  return pushToWhere({ userId }, payload);
}

/** Best-effort push to many Persons at once (fan-out), e.g. everyone in a
 * group chat or everyone matching a broadcast's audience. */
export async function pushToPersons(personIds: string[], payload: PushPayload): Promise<void> {
  if (personIds.length === 0) return;
  return pushToWhere({ personId_in: personIds }, payload);
}
