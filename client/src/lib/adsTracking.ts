import type { PublicSettings } from './usePublicSettings';

// Browser-side ad measurement (Meta pixel, TikTok pixel, Google tag).
//
// Nothing here loads, sets a cookie or contacts an ad platform until the visitor
// has answered "Allow" in the banner (AdsConsentBanner). The choice is kept on
// this device only. A "No" is respected on every later page load.

export type AdsConfig = NonNullable<PublicSettings['ads']>;
export type AdsChoice = 'yes' | 'no';
export type AdsEventName = 'Lead' | 'CompleteRegistration';

const KEY = 'gn_ads_consent';
const CHANGED = 'gn-ads-consent';

let config: AdsConfig | null = null;
let loaded = false;

export function adsConfigured(c: AdsConfig | null | undefined): c is AdsConfig {
  return Boolean(c && (c.metaPixelId || c.tiktokPixelId || c.googleTagId));
}

export function getAdsChoice(): AdsChoice | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

export function setAdsChoice(choice: AdsChoice): void {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    /* private window: the choice lasts until the page closes */
  }
  if (choice === 'yes') loadPixels();
  window.dispatchEvent(new Event(CHANGED));
}

export function onAdsChoiceChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/** Called once the public settings are known. Loads the pixels at once if the visitor already said yes. */
export function configureAds(c: AdsConfig | null | undefined): void {
  config = adsConfigured(c) ? c : null;
  if (getAdsChoice() === 'yes') loadPixels();
}

function addScript(src: string): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

type Win = Window & Record<string, any>;

export function loadPixels(): void {
  if (loaded || !config || getAdsChoice() !== 'yes') return;
  loaded = true;
  const w = window as Win;

  if (config.metaPixelId) {
    // Meta's standard loader, written out.
    if (!w.fbq) {
      const fbq: any = function (...args: unknown[]) {
        fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args);
      };
      if (!w._fbq) w._fbq = fbq;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      w.fbq = fbq;
      addScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    w.fbq('init', config.metaPixelId);
    w.fbq('track', 'PageView');
  }

  if (config.tiktokPixelId) {
    // TikTok's standard loader, written out.
    if (!w.ttq) {
      const methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
      const ttq: any = [];
      w.TiktokAnalyticsObject = 'ttq';
      w.ttq = ttq;
      ttq._i = {};
      ttq._t = {};
      ttq._o = {};
      ttq.methods = methods;
      ttq.setAndDefer = (t: any, m: string) => {
        t[m] = (...a: unknown[]) => t.push([m, ...a]);
      };
      for (const m of methods) ttq.setAndDefer(ttq, m);
      ttq.load = (id: string) => {
        ttq._i[id] = [];
        ttq._t[id] = Date.now();
        addScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`);
      };
    }
    w.ttq.load(config.tiktokPixelId);
    w.ttq.page();
  }

  if (config.googleTagId) {
    w.dataLayer = w.dataLayer || [];
    w.gtag =
      w.gtag ||
      function () {
        // gtag.js reads the "arguments" object itself, not an array.
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer.push(arguments);
      };
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.googleTagId)}`);
    w.gtag('js', new Date());
    w.gtag('config', config.googleTagId);
  }
}

/** A fresh id for one conversion; the browser pixel and the server both use it so the platform counts it once. */
export function newAdEventId(): string {
  try {
    const u = (crypto as Crypto).randomUUID?.();
    if (u) return u;
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Meta's browser cookie, sent with a sign-up so the server event can match it. Only after the visitor allowed it. */
export function getFbp(): string | undefined {
  if (getAdsChoice() !== 'yes') return undefined;
  try {
    const m = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
    return m && /^fb\.\d\.\d{10,15}\.\d{5,20}$/.test(m[1]) ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Tells the loaded pixels that a sign-up step happened. Does nothing unless the visitor allowed ads measurement. */
export function trackAd(event: AdsEventName, eventId: string): void {
  if (!config || getAdsChoice() !== 'yes') return;
  loadPixels();
  const w = window as Win;
  if (config.metaPixelId && w.fbq) w.fbq('track', event, {}, { eventID: eventId });
  if (config.tiktokPixelId && w.ttq) w.ttq.track(event === 'Lead' ? 'SubmitForm' : 'CompleteRegistration', {}, { event_id: eventId });
  const sendTo = event === 'Lead' ? config.googleLeadSendTo : config.googleSignupSendTo;
  if (config.googleTagId && sendTo && w.gtag) w.gtag('event', 'conversion', { send_to: sendTo, transaction_id: eventId });
}

/** For tests only. */
export function resetAdsForTests(): void {
  config = null;
  loaded = false;
}
