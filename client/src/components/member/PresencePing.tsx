import { useEffect } from 'react';
import { api } from '../../lib/api';

const EVERY_MS = 30 * 1000;

// While the member app is open on screen, check in every 30 seconds so
// others see "online". Stops when the app is closed or hidden.
export function PresencePing() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'visible') api.get('/api/member/auth/ping').catch(() => {});
    };
    const timer = window.setInterval(ping, EVERY_MS);
    document.addEventListener('visibilitychange', ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', ping);
    };
  }, []);
  return null;
}
