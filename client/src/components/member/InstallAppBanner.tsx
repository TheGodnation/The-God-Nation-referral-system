import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// "Install the app": puts a God Nation icon on the phone's home screen that
// opens straight into the community. Android/Chrome offer a real install
// prompt; on iPhone we show how to do it from Safari's Share menu. Hidden
// once installed, or after the member closes it.
export function InstallAppBanner() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('installBannerDismissed') === '1';
    } catch {
      return false;
    }
  });

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (standalone || dismissed || (!prompt && !isIos)) return null;

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem('installBannerDismissed', '1');
    } catch {
      /* private mode */
    }
  }

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    setPrompt(null);
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
      <div className="flex-1">
        <p className="font-semibold">{t('installApp.title')}</p>
        <p className="text-brand-800">{prompt ? t('installApp.body') : t('installApp.ios')}</p>
        {prompt && (
          <button type="button" className="btn-primary mt-2 px-3 py-1.5 text-sm" onClick={install}>
            {t('installApp.button')}
          </button>
        )}
      </div>
      <button type="button" aria-label={t('installApp.close') ?? ''} className="text-brand-700" onClick={close}>
        ✕
      </button>
    </div>
  );
}
