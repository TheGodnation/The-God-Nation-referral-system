import { useCallback, useEffect, useState } from 'react';

// "Send a new code" waits a minute after each email. On a slow connection the
// first email can take a while, and people who kept tapping used to get a
// pile of codes and type an older one. The wait is counted from a fixed end
// time, so it stays right even if the phone sleeps in the meantime.
export const RESEND_COOLDOWN_SECONDS = 60;

export function useResendCooldown(seconds = RESEND_COOLDOWN_SECONDS, startNow = true) {
  const [endsAt, setEndsAt] = useState<number | null>(() => (startNow ? Date.now() + seconds * 1000 : null));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null || endsAt <= now) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt, now]);

  const start = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setEndsAt(t + seconds * 1000);
  }, [seconds]);

  const remaining = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return { remaining, start };
}
