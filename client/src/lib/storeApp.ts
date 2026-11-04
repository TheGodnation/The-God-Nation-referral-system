// The Google Play version of the app (a Trusted Web Activity) opens this same website, but must not
// show prices or take payment for books: there, a member asks to read and the central admin approves.
//
// Play opens the app with the referrer "android-app://<package>", so the first page load tells us.
// The answer is kept for the rest of that session only (never in long-term storage), because the
// Chrome browser on the same phone shares this website's storage with the Play app and must not
// inherit the setting. To look at the Play version in any browser, open the site with ?app=play
// (and ?app=web to go back).

const KEY = 'godnation:store-app';

export function isStoreApp(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    if (q.get('app') === 'play') sessionStorage.setItem(KEY, '1');
    else if (q.get('app') === 'web') sessionStorage.removeItem(KEY);
    else if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** True in the Play Store version: no prices, no payment screens, "Request to read" instead. */
export function useStoreApp(): boolean {
  return isStoreApp();
}
