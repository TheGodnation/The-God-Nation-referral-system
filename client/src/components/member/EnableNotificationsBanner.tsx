import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useTranslation } from 'react-i18next';
import { GuideLink } from './GuideLink';
import { enablePushNotifications, checkPushOnThisDevice, prefetchPushKey, type PushDeviceStatus } from '../../lib/push';

const DISMISS_KEY = 'notifyBannerDismissed';
const VISIT_KEY = 'notifyBannerVisit'; // sessionStorage: '1' = shown during this visit, '0' = rests during this visit
const SHOWN_KEY = 'notifyBannerShownAt'; // localStorage: when it was shown on this phone (a list of times)
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_WEEK = 2;
const MIN_GAP_DAYS = 3;

/**
 * Whether the banner may show during this visit (opening the app). On the pages where it is not permanent it shows at most
 * twice in any 7 days on this phone, at least 3 days apart. The decision is made once per visit and kept while the person
 * moves between pages, so it does not come and go.
 */
export function bannerShowsThisVisit(now = Date.now()): boolean {
  try {
    const decided = sessionStorage.getItem(VISIT_KEY);
    if (decided === '1') return true;
    if (decided === '0') return false;
  } catch {
    /* private mode: decide every time */
  }
  let history: number[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]');
    if (Array.isArray(parsed)) history = parsed.filter((n) => typeof n === 'number');
  } catch {
    /* unreadable: start again */
  }
  const recent = history.filter((t) => now - t < 7 * DAY_MS);
  const lastShown = recent.length ? Math.max(...recent) : 0;
  const allowed = recent.length < MAX_PER_WEEK && (recent.length === 0 || now - lastShown >= MIN_GAP_DAYS * DAY_MS);
  try {
    sessionStorage.setItem(VISIT_KEY, allowed ? '1' : '0');
    if (allowed) localStorage.setItem(SHOWN_KEY, JSON.stringify([...recent, now].slice(-10)));
  } catch {
    /* private mode */
  }
  return allowed;
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

// "Turn on notifications", shown at the top of the main member pages (never
// inside an open chat, where it would cover messages or the typing box). It
// keeps coming back until this device really receives notifications —
// checked against the actual push subscription, not just whether "Allow" was
// once tapped. ✕ hides it for the rest of this visit (sessionStorage, so it
// stays closed while moving between pages, and returns on the next visit).
// `rule="always"` (the Me page) keeps it there with no ✕ until notifications are on; the default rule shows it only when the
// app is opened, at most twice a week (see bannerShowsThisVisit), and never to someone who already has notifications.
// Where notifications can't be turned on here (iPhone outside the Home
// Screen app, or a browser without Push), it says what to do instead of
// silently hiding. A browser-level block can't be undone by any site, so
// that case points the member to their device settings.
export function EnableNotificationsBanner({ className = 'mb-4', rule = 'twiceWeekly' }: { className?: string; rule?: 'always' | 'twiceWeekly' }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Whether this visit may show it (decided once the device is known not to have notifications yet).
  const [visitOk, setVisitOk] = useState(rule === 'always');

  useEffect(() => {
    let cancelled = false;
    void checkPushOnThisDevice().then((s) => {
      if (cancelled) return;
      setStatus(s);
      if (rule !== 'always' && s !== 'subscribed') setVisitOk(bannerShowsThisVisit());
      // Ready before the tap: the server's key is fetched while the banner is simply showing.
      if (s === 'not_subscribed') void prefetchPushKey().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // On the profile page ("always"), a phone that already has notifications gets a way to check that they really arrive.
  if (rule === 'always' && status === 'subscribed') return <SelfTestStrip className={className} />;
  if ((rule !== 'always' && dismissed) || !visitOk || status === null || status === 'subscribed') return null;

  function close() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode */
    }
  }

  async function enable() {
    setBusy(true);
    setFailed(false);
    // The moment "Allow" is tapped the banner says done; the network part finishes behind it, and if that fails it comes back with the message.
    const result = await enablePushNotifications({ onGranted: () => setStatus('subscribed') });
    setBusy(false);
    if (result.ok) {
      setStatus('subscribed');
    } else if (result.reason === 'denied') {
      setStatus('denied');
    } else {
      setStatus('not_subscribed');
      setFailed(true);
    }
  }

  const message =
    status === 'denied'
      ? t('notifications.blocked_body')
      : status === 'ios_needs_home_screen'
        ? t('notifications.ios_home_screen_body')
        : status === 'ios_too_old'
          ? t('notifications.ios_too_old_body')
          : status === 'unsupported'
            ? t('notifications.unsupported_body')
            : t('notifications.enable_body');

  const canTurnOn = status === 'not_subscribed';
  const blocked = status === 'denied';
  return (
    <div className={`${className} flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm text-brand-900`} data-testid="enable-notifications">
      <span className="text-lg leading-6" aria-hidden="true">🔔</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-[1.1rem] text-brand-800">
          <span className="text-sm font-semibold text-brand-900">{t('notifications.enable_title')}. </span>
          {message}
        </p>
        {failed && <p className="mt-1 text-xs text-red-700">{t('notifications.enable_failed')}</p>}
        <div className="mt-1 flex items-center gap-3">
          {canTurnOn && (
            <button type="button" disabled={busy} className="btn-primary whitespace-nowrap px-3 py-1.5 text-sm disabled:opacity-60" onClick={() => void enable()}>
              {busy ? t('notifications.enabling') : t('notifications.enable_button')}
            </button>
          )}
          {blocked ? (
            <GuideLink href="/phone-settings-guide/" className="btn-primary inline-block px-3 py-1.5 text-sm no-underline">
              {t('notifications.blocked_button')}
            </GuideLink>
          ) : (
            <GuideLink href="/notifications-guide/" className="whitespace-nowrap text-xs font-semibold text-brand-700 underline">
              {t('notifications.need_help')}
            </GuideLink>
          )}
        </div>
      </div>
      {rule !== 'always' && (
        <button type="button" aria-label={t('notifications.dismiss') ?? ''} className="px-1 leading-6 text-brand-700" onClick={close}>
          ✕
        </button>
      )}
    </div>
  );
}

// "Notifications are on on this phone · Send me a test alert": the alert comes straight back, so the member sees it works (or learns
// that their phone holds it back, for example because of battery saving).
function SelfTestStrip({ className }: { className: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'none' | 'failed'>('idle');
  async function test() {
    setState('sending');
    try {
      const r = await api.post<{ devices: number; sent: number }>('/api/notifications/push/test', {});
      setState(r.sent > 0 ? 'sent' : 'none');
    } catch {
      setState('failed');
    }
  }
  return (
    <div className={`${className} space-y-1 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900`} data-testid="notifications-on">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">🔔</span>
        <span className="flex-1">{t('notifications.on_this_phone')}</span>
        <button type="button" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-green-800 ring-1 ring-green-300" disabled={state === 'sending'} onClick={() => void test()} data-testid="notifications-self-test">
          {t('notifications.test_me')}
        </button>
      </div>
      {state === 'sent' && <p className="text-xs" data-testid="notifications-self-test-result">{t('notifications.test_sent')}</p>}
      {state === 'none' && <p className="text-xs" data-testid="notifications-self-test-result">{t('notifications.test_none')}</p>}
      {state === 'failed' && <p className="text-xs text-red-700" data-testid="notifications-self-test-result">{t('notifications.test_failed')}</p>}
    </div>
  );
}
