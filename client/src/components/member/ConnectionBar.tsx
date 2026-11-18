import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isServerReachable } from '../../lib/api';

// A small, calm tab hanging from the top centre — "● Connecting… you can still read what is saved" — when the phone is offline
// or the server can't be reached. It never covers the page or catches a tap (taps go straight through it). While it
// shows, the app quietly checks every few seconds and the tab disappears by itself when the network is back.
export function ConnectionBar() {
  const { t } = useTranslation();
  const [down, setDown] = useState(() => (typeof navigator !== 'undefined' && navigator.onLine === false) || !isServerReachable());

  useEffect(() => {
    const onReach = (e: Event) => setDown(!(e as CustomEvent<boolean>).detail);
    const onOffline = () => setDown(true);
    const onOnline = () => api.get('/api/member/auth/ping').catch(() => {});
    window.addEventListener('api-reachable', onReach);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('api-reachable', onReach);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (!down) return;
    const timer = window.setInterval(() => api.get('/api/member/auth/ping').catch(() => {}), 10000);
    return () => window.clearInterval(timer);
  }, [down]);

  if (!down) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-0 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-1.5 rounded-b-xl border border-t-0 border-brand-200 bg-brand-50/95 px-3 py-0.5 text-[11px] font-medium leading-4 text-brand-900 shadow-sm backdrop-blur"
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <span className="truncate">{t('network.connecting')}</span>
    </div>
  );
}
