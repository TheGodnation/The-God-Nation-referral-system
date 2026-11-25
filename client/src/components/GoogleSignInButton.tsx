import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

// "Continue with Google". The button only appears once Google sign-in has been set up on the server (it gives the public Client ID);
// until then this renders nothing, so the sign-in page looks exactly as before. Google's own button gives back a signed ID token,
// which the page sends to the server to be checked.

interface GoogleId {
  initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; use_fedcm_for_button?: boolean }) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = SCRIPT_SRC;
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scriptPromise = null; // try again next time
        reject(new Error('Google script did not load'));
      };
      document.head.appendChild(el);
    });
  }
  return scriptPromise;
}

export function GoogleSignInButton({ onCredential, withDivider = false }: { onCredential: (credential: string) => void; withDivider?: boolean }) {
  const { t, i18n } = useTranslation();
  const holder = useRef<HTMLDivElement | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    let alive = true;
    api
      .get<{ clientId: string | null }>('/api/member/auth/google-config')
      .then((r) => alive && setClientId(r?.clientId ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    loadGoogleScript()
      .then(() => {
        const id = window.google?.accounts?.id;
        if (!alive || !id || !holder.current) return;
        // use_fedcm_for_button: where the browser can (Chrome, Android included), the account is chosen in the browser's own sign-in
        // panel on this page instead of in a separate Google tab, whose hand-back to the page could get stuck on phones (tap the email,
        // nothing happens). Browsers that cannot do it keep the separate Google window, as before.
        id.initialize({ client_id: clientId, callback: (r) => r.credential && callback.current(r.credential), ux_mode: 'popup', auto_select: false, use_fedcm_for_button: true });
        id.renderButton(holder.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left', width: 300, locale: i18n.language.startsWith('fr') ? 'fr' : 'en' });
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clientId, i18n.language]);

  if (!clientId) return null;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="google-signin" data-ready={ready ? 'yes' : 'no'}>
      {withDivider && (
        <div className="flex w-full items-center gap-3 text-xs uppercase tracking-wide text-slate-400" role="separator" data-testid="google-or">
          <span className="h-px flex-1 bg-slate-200" />
          {t('memberLogin.or')}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      )}
      <div ref={holder} />
    </div>
  );
}
