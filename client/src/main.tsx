import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';
import './index.css';
import { reloadOnceForNewVersion, reportClientError } from './lib/reportError';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

// The app was updated while this page was open, so one of its files is gone:
// load the page again (once) instead of leaving a broken screen.
window.addEventListener('vite:preloadError', (event) => {
  // Only when the page is really being reloaded is the error swallowed. Otherwise it must
  // reach the error screen as it is: swallowing it makes the page fail with a confusing
  // "undefined is not an object" instead of the real reason.
  if (reloadOnceForNewVersion()) event.preventDefault();
});
// A script error outside any screen (the screen's own errors are reported by the ErrorBoundary).
window.addEventListener('error', (event) => {
  if (event.error) reportClientError('script', event.error);
});

// Registers the PWA service worker (app-shell caching only — never /api/*,
// see public/sw.js) so the site can be installed to a phone's home screen.
// Guarded so a browser without support, or a failed registration, never
// breaks the app itself.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}
