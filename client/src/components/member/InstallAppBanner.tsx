import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstallPrompt } from '../../lib/installPrompt';

// "Install the app": puts a God Nation icon on the phone's home screen that
// opens straight into the community. Android/Chrome offer a real install
// prompt; on iPhone we show how to do it from Safari's Share menu. Hidden
// once installed, or after the member closes it.
export function InstallAppBanner() {
  const { t } = useTranslation();
  const { installed, canPrompt, ios, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('installBannerDismissed') === '1';
    } catch {
      return false;
    }
  });

  if (installed || dismissed || (!canPrompt && !ios)) return null;

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem('installBannerDismissed', '1');
    } catch {
      /* private mode */
    }
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
      <div className="flex-1">
        <p className="font-semibold">{t('installApp.title')}</p>
        <p className="text-brand-800">{canPrompt ? t('installApp.body') : t('installApp.ios')}</p>
        <div className="mt-2 flex items-center gap-3">
          {canPrompt && (
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => void install()}>
              {t('installApp.button')}
            </button>
          )}
          <a href="/notifications-guide/" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-700 underline">
            {t('installApp.need_help')}
          </a>
        </div>
      </div>
      <button type="button" aria-label={t('installApp.close') ?? ''} className="text-brand-700" onClick={close}>
        ✕
      </button>
    </div>
  );
}
