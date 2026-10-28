import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enablePushNotifications, checkPushOnThisDevice, type PushDeviceStatus } from '../../lib/push';

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
      if (!cancelled) setStatus(s);
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
    const result = await enablePushNotifications();
    setBusy(false);
    if (result.ok) {
      setStatus('subscribed');
    } else if (result.reason === 'denied') {
      setStatus('denied');
    } else {
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

  return (
    <div className={`${className} flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900`}>
      <span className="text-lg leading-6" aria-hidden="true">🔔</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-6">{t('notifications.enable_title')}</p>
        <p className="text-xs text-brand-800">{message}</p>
        {failed && <p className="mt-1 text-xs text-red-700">{t('notifications.enable_failed')}</p>}
        <div className="mt-1.5 flex items-center gap-3">
          {status === 'not_subscribed' && (
            <button type="button" disabled={busy} className="btn-primary px-3 py-1 text-xs disabled:opacity-60" onClick={() => void enable()}>
              {busy ? t('notifications.enabling') : t('notifications.enable_button')}
            </button>
          )}
          <a href={status === 'denied' ? '/phone-settings-guide/' : '/notifications-guide/'} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-700 underline">
            {t('notifications.need_help')}
          </a>
        </div>
      </div>
      <button type="button" aria-label={t('notifications.dismiss') ?? ''} className="px-1 leading-6 text-brand-700" onClick={close}>
        ✕
      </button>
    </div>
  );
}
