import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotificationBenefits } from './NotificationBenefits';
import { checkPushOnThisDevice, enablePushNotifications, isStandalone, type PushDeviceStatus } from '../../lib/push';

const KEY = 'godnation:askedPushAfterInstall';
const flag = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // no storage: do not nag on every visit
  }
};
const setFlag = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
};

// The first time the app is opened as the installed app, ask once, clearly, to turn on notifications: that is the moment it
// matters most (on iPhone notifications only work from the installed app) and the moment the member is most willing.
// After it is answered or closed it never shows again; the usual notifications banner still comes back on later visits.
export function AfterInstallPushAsk() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [shown, setShown] = useState(() => isStandalone() && !flag());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    void checkPushOnThisDevice().then((s) => {
      if (cancelled) return;
      if (s === 'subscribed') {
        setFlag(); // nothing to ask
        setShown(false);
      } else setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [shown]);

  // Only when turning on is possible here (a blocked or unsupported phone gets the usual banner with its own guidance).
  if (!shown || status !== 'not_subscribed') return null;

  function close() {
    setFlag();
    setShown(false);
  }
  async function enable() {
    setBusy(true);
    setFailed(false);
    const result = await enablePushNotifications();
    setBusy(false);
    if (result.ok) close();
    else if (result.reason === 'denied') close();
    else setFailed(true);
  }

  return (
    <div className="mb-4 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-3 text-brand-900 shadow-sm" role="region" aria-label={t('afterInstall.title') ?? ''} data-testid="after-install-ask">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg text-white" aria-hidden="true">🎉</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-5">{t('afterInstall.title')}</p>
          <p className="mt-0.5 text-xs text-brand-800">{t('afterInstall.body')}</p>
          <NotificationBenefits />
          {failed && <p className="mt-1 text-xs text-red-700">{t('notifications.enable_failed')}</p>}
          <div className="mt-2.5 flex items-center gap-4">
            <button type="button" disabled={busy} onClick={() => void enable()} className="btn-primary px-4 py-2 text-sm disabled:opacity-60" data-testid="after-install-enable">
              {busy ? t('notifications.enabling') : t('notifications.enable_button')}
            </button>
            <button type="button" onClick={close} className="text-sm font-semibold text-brand-700 underline" data-testid="after-install-later">
              {t('afterInstall.later')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
