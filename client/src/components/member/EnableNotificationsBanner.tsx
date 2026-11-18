import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GuideLink } from './GuideLink';
import { enablePushNotifications, checkPushOnThisDevice, prefetchPushKey, type PushDeviceStatus } from '../../lib/push';

const DISMISS_KEY = 'notifyBannerDismissed';

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
// Where notifications can't be turned on here (iPhone outside the Home
// Screen app, or a browser without Push), it says what to do instead of
// silently hiding. A browser-level block can't be undone by any site, so
// that case points the member to their device settings.
export function EnableNotificationsBanner({ className = 'mb-4' }: { className?: string }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkPushOnThisDevice().then((s) => {
      if (cancelled) return;
      setStatus(s);
      // Ready before the tap: the server's key is fetched while the banner is simply showing.
      if (s === 'not_subscribed') void prefetchPushKey().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || status === null || status === 'subscribed') return null;

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
  return (
    <div className={`${className} rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-3 text-sm text-brand-900 shadow-sm`} data-testid="enable-notifications">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg text-white" aria-hidden="true">🔔</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-5 text-brand-900">{t('notifications.enable_title')}</p>
          <p className="mt-0.5 text-xs text-brand-800">{message}</p>
          {canTurnOn && (
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="notify-benefits">
              {(['events', 'teachings', 'messages'] as const).map((k) => (
                <li key={k} className="flex items-center gap-1 rounded-full border border-brand-100 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-900">
                  <span aria-hidden="true">{k === 'events' ? '📅' : k === 'teachings' ? '📖' : '💬'}</span>
                  {t(`notifications.benefit_${k}`)}
                </li>
              ))}
            </ul>
          )}
          {failed && <p className="mt-1 text-xs text-red-700">{t('notifications.enable_failed')}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {canTurnOn && (
              <button type="button" disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60" onClick={() => void enable()}>
                {busy ? t('notifications.enabling') : t('notifications.enable_button')}
              </button>
            )}
            <GuideLink href={status === 'denied' ? '/phone-settings-guide/' : '/notifications-guide/'} className="text-xs font-semibold text-brand-700 underline">
              {t('notifications.need_help')}
            </GuideLink>
          </div>
          {canTurnOn && <p className="mt-1.5 text-[11px] text-brand-700">{t('notifications.enable_tail')}</p>}
        </div>
        <button type="button" aria-label={t('notifications.dismiss') ?? ''} className="px-1 leading-6 text-brand-700" onClick={close}>
          ✕
        </button>
      </div>
    </div>
  );
}
