import { useEffect, useState } from 'react';
import { isIos, isStandalone } from './push';

// "Install the app" on Android/Chrome: the browser offers its install prompt only once per page load, early, so it is
// caught at start-up (main.tsx) and kept here for whichever screen shows the install button later.
let deferred: any = null;
// The browser told us the app was just installed (it may still be open in the browser tab).
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const isAndroid = (): boolean => /android/i.test(ua());
export const isInAppBrowser = (): boolean => /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|TikTok|musical_ly/i.test(ua());

export interface InstallState {
  /** Already running as the installed app. */
  installed: boolean;
  /** The browser can show its own install prompt right now (Android/Chrome). */
  canPrompt: boolean;
  /** iPhone/iPad: no prompt exists, the person adds it from Safari's Share menu. */
  ios: boolean;
  /** An Android phone (where the browser menu has "Install app" / "Add to Home screen"). */
  android: boolean;
  /** Opened inside another app's built-in browser (Facebook, WhatsApp, Instagram...), where installing is not possible. */
  inAppBrowser: boolean;
  /** Shows the browser's prompt; resolves true if the person accepted. */
  install: () => Promise<boolean>;
}

export function useInstallPrompt(): InstallState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    notify();
    try {
      e.prompt();
      const choice = await e.userChoice;
      if (choice?.outcome === 'accepted') {
        justInstalled = true;
        notify();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return { installed: justInstalled || isStandalone(), canPrompt: !!deferred, ios: isIos(), android: isAndroid(), inAppBrowser: isInAppBrowser(), install };
}
