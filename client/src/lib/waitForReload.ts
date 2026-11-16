// Right after the app is updated, an open page may ask for a screen file that no longer exists.
// main.tsx then starts loading the page again (vite:preloadError), and the failed import resolves
// to nothing instead of throwing. Returning this keeps the screen on its loading state until the
// reload takes over, instead of flashing an error like "Cannot read properties of undefined".
export function waitForReload(): never {
  return new Promise(() => {}) as never;
}
