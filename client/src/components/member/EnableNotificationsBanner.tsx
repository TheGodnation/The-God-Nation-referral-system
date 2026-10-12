import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enablePushNotifications, currentPushPermission } from '../../lib/push';

// "Turn on notifications": the actual delivery half of removing the mute
// option — a Notification row in the database does nothing for a member
// who has closed the app, only a real Push subscription does. Shown once,
// only while permission hasn't been decided yet either way (never shown
// again after granted, denied, or dismissed — re-prompting a denial is not
// something this app can do anyway; only the browser's own site settings
// can undo that).
export function EnableNotificationsBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('notifBannerDismissed') === '1';
    } catch {
      return false;
    }
  });
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPermission(currentPushPermission());
  }, []);

  if (dismissed || permission !== 'default') return null;

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem('notifBannerDismissed', '1');
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
      setPermission('granted');
    } else if (result.reason === 'denied') {
      setPermission('denied');
    } else {
      setFailed(true);
    }
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
      <span className="text-2xl" aria-hidden="true">🔔</span>
      <div className="flex-1">
        <p className="font-semibold">{t('notifications.enable_title')}</p>
        <p className="text-brand-800">{t('notifications.enable_body')}</p>
        {failed && <p className="mt-1 text-xs text-red-700">{t('notifications.enable_failed')}</p>}
        <div className="mt-2 flex items-center gap-3">
          <button type="button" disabled={busy} className="btn-primary px-3 py-1.5 text-sm disabled:opacity-60" onClick={() => void enable()}>
            {busy ? t('notifications.enabling') : t('notifications.enable_button')}
          </button>
          <a href="/notifications-guide/" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-700 underline">
            {t('notifications.need_help')}
          </a>
        </div>
      </div>
      <button type="button" aria-label={t('installApp.close') ?? ''} className="text-brand-700" onClick={close}>
        ✕
      </button>
    </div>
  );
}
