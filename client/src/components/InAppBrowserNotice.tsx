import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Many people arrive from an advertisement inside Facebook's, Instagram's or
// TikTok's built-in browser. There, notifications and installing the app do not
// work. This gently asks them to open the page in their phone's own browser.

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|TikTok|Twitter|Snapchat|LinkedInApp|Line\/|MicroMessenger/i;
const ANDROID_WEBVIEW = /; wv\)/;

export function detectInAppBrowser(ua: string): { inApp: boolean; android: boolean; ios: boolean } {
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  return { inApp: IN_APP.test(ua) || (android && ANDROID_WEBVIEW.test(ua)), android, ios };
}

/** A link that asks Android to open this page in Chrome. */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
}

const KEY = 'inAppBrowserNoticeDismissed';

export function InAppBrowserNotice({ userAgent, href }: { userAgent?: string; href?: string }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const here = href ?? (typeof window !== 'undefined' ? window.location.href : '');
  const d = detectInAppBrowser(ua);
  if (!d.inApp || hidden || !here) return null;

  function dismiss() {
    setHidden(true);
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(here);
      setCopied(true);
    } catch {
      /* the link is still on screen */
    }
  }

  return (
    <div role="note" className="mx-auto my-3 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="in-app-browser-notice">
      <p className="font-semibold">{t('inApp.title')}</p>
      <p className="mt-1">{d.ios ? t('inApp.body_ios') : t('inApp.body_android')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {d.android && (
          <a href={chromeIntentUrl(here)} className="rounded-lg bg-brand-800 px-3 py-1.5 font-semibold text-white no-underline" data-testid="open-in-chrome">
            {t('inApp.open_chrome')}
          </a>
        )}
        <button type="button" onClick={copy} className="rounded-lg border border-amber-400 px-3 py-1.5 font-semibold">
          {t('inApp.copy')}
        </button>
        <button type="button" onClick={dismiss} className="ml-auto text-xs underline">
          {t('inApp.dismiss')}
        </button>
      </div>
      {copied && <p role="status" className="mt-2 text-xs">{t('inApp.copied')}</p>}
    </div>
  );
}
