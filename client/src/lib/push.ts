import { api } from './api';

// Web Push subscription — the client half of lib/push.ts on the server.
// Subscribing only ever happens after the member explicitly asks (the
// EnableNotificationsBanner's button): the browser's own permission
// prompt is a one-shot, irreversible-by-us dialog, so this app never
// triggers it silently on page load.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not_configured' | 'failed' };

/** Requests Notification permission (the real browser dialog) and, once
 * granted, registers a Push subscription with the server. Safe to call
 * repeatedly — re-subscribing an already-subscribed device just confirms
 * the existing registration. */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const { configured, publicKey } = await api.get<{ configured: boolean; publicKey: string | null }>(
      '/api/notifications/push/vapid-public-key',
    );
    if (!configured || !publicKey) return { ok: false, reason: 'not_configured' };

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    await api.post('/api/notifications/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Unregisters the current device's subscription, both server-side and in
 * the browser itself. Used if a member turns notifications back off. */
export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api.delete('/api/notifications/push/subscribe', { endpoint: subscription.endpoint }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
  } catch {
    // Best-effort — nothing more useful to do if the service worker/browser
    // API itself is unavailable here.
  }
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true)
  );
}

export type PushDeviceStatus =
  | 'subscribed'
  | 'not_subscribed'
  | 'denied'
  // iPhone in a Safari tab: Apple only allows web notifications from the
  // Home Screen app, so the step is "add to Home Screen", not "allow".
  | 'ios_needs_home_screen'
  // iPhone Home Screen app on an iOS too old for web notifications (<16.4).
  | 'ios_too_old'
  // Any other browser without Push — usually an app's built-in browser
  // (e.g. opening a link from inside another app).
  | 'unsupported';

let confirmedWithServer = false;

/** Whether this device will actually receive notifications. "Allowed" alone
 * isn't enough: permission can be granted while no push subscription exists
 * (the subscribe step failed, or the browser dropped it). When this device
 * is subscribed, it also re-sends the subscription to the server once per
 * visit — an idempotent upsert — so a subscription the server lost or never
 * got is repaired without the member doing anything. */
export async function checkPushOnThisDevice(): Promise<PushDeviceStatus> {
  if (!pushSupported()) {
    if (isIos()) return isStandalone() ? 'ios_too_old' : 'ios_needs_home_screen';
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'not_subscribed';
  try {
    // getRegistration, not .ready: .ready never settles if the service
    // worker failed to register, which would leave the caller waiting forever.
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return 'not_subscribed';
    if (!confirmedWithServer) {
      confirmedWithServer = true;
      const json = subscription.toJSON();
      void api
        .post('/api/notifications/push/subscribe', { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent })
        .catch(() => {
          confirmedWithServer = false;
        });
    }
    return 'subscribed';
  } catch {
    return 'not_subscribed';
  }
}
