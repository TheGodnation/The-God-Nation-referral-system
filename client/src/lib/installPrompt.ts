import { useEffect, useState } from 'react';
import { isIos, isStandalone } from './push';

// "Install the app" on Android/Chrome: the browser offers its install prompt only once per page load, early, so it is
// caught at start-up (main.tsx) and kept here for whichever screen shows the install button later.
let deferred: any = null;
// The browser told us the app was just installed (it may still be open in the browser tab).
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Once this phone is known to have the app installed (seen running as the app, the browser says so, or the person said so),
// that is remembered here, so every screen stops asking. A browser tab cannot see on its own whether the app is installed.
const INSTALLED_KEY = 'godnation:installed';
function installedFlag(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}
export function rememberInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, '1');
  } catch {
    /* private mode: it is simply not remembered */
  }
  notify();
}

/**
 * Chrome on Android can say, from a normal browser tab, whether this site's app is installed on the phone (the manifest lists
 * itself as a related "webapp"). Other browsers can't, and then the app only learns it when it is opened as the app.
 */
export async function checkInstalledRelatedApps(): Promise<boolean> {
  try {
    const get = (navigator as unknown as { getInstalledRelatedApps?: () => Promise<{ platform?: string }[]> }).getInstalledRelatedApps;
    if (typeof get !== 'function') return false;
    const apps = await get.call(navigator);
    const found = Array.isArray(apps) && apps.some((a) => a?.platform === 'webapp');
    if (found) rememberInstalled();
    return found;
  } catch {
    return false;
  }
}

export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  // Running as the installed app right now: that settles it. In a browser tab, ask the browser if it can tell.
  if (isStandalone()) rememberInstalled();
  else void checkInstalledRelatedApps();
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    rememberInstalled();
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
        rememberInstalled();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return { installed: justInstalled || isStandalone() || installedFlag(), canPrompt: !!deferred, ios: isIos(), android: isAndroid(), inAppBrowser: isInAppBrowser(), install };
}
