import { api } from './api';

// Records where a visitor came from (the ad, the link, the website), so the
// growth report can tell which ads, links and ambassadors bring people who
// stay. Only the website name of the referring page is sent, never the full
// address. Nothing here sets a third-party tracker.

const SEEN_KEY = 'gn_visit_seen';
const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'ttclid', 'gclid'] as const;

export interface VisitPayload {
  ref?: string;
  lang?: 'en' | 'fr';
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  fbclid?: string;
  ttclid?: string;
  gclid?: string;
  referrer?: string;
  landingPage: string;
}

/** Everything the address and the previous page tell us about this visit. */
export function visitDetails(search: string, referrer: string, pathname: string): VisitPayload {
  const p = new URLSearchParams(search);
  const get = (k: string) => p.get(k) || undefined;
  return {
    ref: get('ref'),
    lang: p.get('lang') === 'fr' ? 'fr' : p.get('lang') === 'en' ? 'en' : undefined,
    utmSource: get('utm_source'),
    utmMedium: get('utm_medium'),
    utmCampaign: get('utm_campaign'),
    utmContent: get('utm_content'),
    fbclid: get('fbclid'),
    ttclid: get('ttclid'),
    gclid: get('gclid'),
    referrer: referrer || undefined,
    landingPage: pathname + search,
  };
}

export function recordVisit(extra?: Partial<VisitPayload>): Promise<unknown> {
  const body = { ...visitDetails(window.location.search, document.referrer, window.location.pathname), ...extra };
  return api.post('/api/referrals/visit', body);
}

function hasTrackingParams(search: string): boolean {
  const p = new URLSearchParams(search);
  return PARAMS.some((k) => p.has(k));
}

function fromAnotherSite(referrer: string): boolean {
  try {
    return Boolean(referrer) && new URL(referrer).hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

/**
 * Records the first visit from this phone, and any later visit that arrives
 * through an ad (tracking codes in the address) or from another website.
 * Members opening the app on their own every day are not counted again.
 * The referral pages (/join, /welcome) record their own visit.
 */
export function recordLandingVisitOnce(): void {
  const { pathname, search } = window.location;
  if (pathname === '/join' || pathname === '/welcome') return;
  let firstEver = false;
  try {
    firstEver = localStorage.getItem(SEEN_KEY) !== '1';
    if (firstEver) localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // No storage (private mode): only count visits that carry tracking details.
  }
  if (!firstEver && !hasTrackingParams(search) && !fromAnotherSite(document.referrer)) return;
  void recordVisit().catch(() => {});
}
