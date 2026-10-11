import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isServerReachable } from '../../lib/api';

// A small bar at the top — "📶 Connecting…" — when the phone is offline or
// the server can't be reached. While it shows, the app quietly checks
// every few seconds and the bar disappears by itself when it's back.
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
    <div role="status" className="fixed inset-x-0 top-0 z-[60] bg-amber-500 px-3 py-1 text-center text-xs font-semibold text-white shadow">
      📶 {t('network.connecting')}
    </div>
  );
}
