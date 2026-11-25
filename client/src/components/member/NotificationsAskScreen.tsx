import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkPushOnThisDevice, enablePushNotifications, prefetchPushKey } from '../../lib/push';

const KEY = 'godnation:notifyAsk:last';
/** After "Not now", the screen comes back at most once a week until notifications are on. */
export const ASK_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function lastAsked(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return Date.now(); // no storage: do not show it on every visit
  }
}
function rememberAsked(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

// A full screen that asks, simply, to turn on notifications: what the member will be told about (messages, teachings, reminders),
// one big "Yes, turn on notifications" button (then the phone asks "Allow?"), and a small "Not now". The phone never lets an app
// turn notifications on by itself, so this is the shortest way: one tap here, one "Allow" on the phone's own question.
// It shows the first time a member arrives (right after registering) and, after "Not now", at most once a week until they are on.
export function NotificationsAskScreen() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const last = lastAsked();
    if (last !== null && Date.now() - last < ASK_AGAIN_AFTER_MS) return;
    let cancelled = false;
    void checkPushOnThisDevice().then((s) => {
      if (cancelled) return;
      // Only when turning on is possible right here (a blocked or unsupported phone gets the usual banner with its own guidance).
      if (s === 'not_subscribed') {
        setShow(true);
        void prefetchPushKey().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  function close() {
    rememberAsked();
    setShow(false);
  }
  async function yes() {
    setBusy(true);
    setFailed(false);
    const result = await enablePushNotifications();
    setBusy(false);
    if (result.ok || result.reason === 'denied') close();
    else setFailed(true);
  }

  const items = [
    { icon: '💬', title: t('notifyAsk.messages_t'), body: t('notifyAsk.messages_b') },
    { icon: '🎙️', title: t('notifyAsk.teachings_t'), body: t('notifyAsk.teachings_b') },
    { icon: '⏰', title: t('notifyAsk.reminders_t'), body: t('notifyAsk.reminders_b') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gradient-to-b from-white via-brand-50 to-white" role="dialog" aria-modal="true" aria-labelledby="notify-ask-title" data-testid="notify-ask">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-6 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
        <div className="flex justify-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-700 text-5xl shadow-lg shadow-brand-900/20" aria-hidden>
            🔔
          </span>
        </div>
        <h1 id="notify-ask-title" className="mt-6 text-center text-3xl font-extrabold leading-tight tracking-tight text-brand-950">
          {t('notifyAsk.title')}
        </h1>
        <ul className="mt-8 space-y-5">
          {items.map((it) => (
            <li key={it.title} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-brand-600 bg-white text-brand-700" role="img" aria-label="✓">
                ✓
              </span>
              <span>
                <span className="block text-lg font-semibold text-slate-900">
                  <span aria-hidden className="mr-1">{it.icon}</span>
                  {it.title}
                </span>
                <span className="block text-[15px] text-slate-600">{it.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-10">
          {failed && <p role="alert" className="mb-3 text-center text-sm text-red-700">{t('notifications.enable_failed')}</p>}
          <button type="button" className="w-full rounded-xl bg-brand-700 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-brand-900/20 disabled:opacity-60" disabled={busy} onClick={() => void yes()} data-testid="notify-ask-yes">
            {busy ? t('notifications.enabling') : t('notifyAsk.yes')}
          </button>
          <p className="mt-2 text-center text-sm text-slate-600">{t('notifyAsk.then_allow')}</p>
          <button type="button" className="mt-4 w-full py-2 text-center text-sm font-semibold text-slate-500" onClick={close} data-testid="notify-ask-later">
            {t('notifyAsk.not_now')}
          </button>
        </div>
      </div>
    </div>
  );
}
