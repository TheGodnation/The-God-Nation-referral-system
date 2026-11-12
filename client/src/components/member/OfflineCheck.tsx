import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { savedThreadCount } from '../../lib/chatCache';
import { listSaved } from '../../lib/offlineStore';

// "Ready for offline?": a plain list of what this phone has saved so the app, the chats and the
// books open without internet, and what to do about anything missing. Everything it looks at is
// on this phone, except one tiny test of the connection. Shown at the top of Me → Downloads.

const SHELL_CACHE = 'god-nation-shell-v1';
const SHELL_KEY = '/__offline-shell';

interface Facts {
  connection: 'ok' | 'slow' | 'none' | null;
  start: boolean | null;
  installed: boolean;
  protectedStore: boolean | null;
  chats: number;
  books: number;
  docs: number;
}

async function testConnection(): Promise<'ok' | 'slow' | 'none'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'none';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const res = await fetch('/api/health', { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
    return res.ok ? 'ok' : 'slow';
  } catch {
    return controller?.signal.aborted ? 'slow' : 'none';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function startPageSaved(): Promise<boolean | null> {
  try {
    if (typeof caches === 'undefined' || !('serviceWorker' in navigator)) return null;
    const cache = await caches.open(SHELL_CACHE);
    return Boolean(await cache.match(SHELL_KEY));
  } catch {
    return null;
  }
}

const isInstalled = () => {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

export function OfflineCheck() {
  const { t } = useTranslation();
  const { member } = useMemberAuth();
  const ownerId = member?.personId ?? '';
  const [facts, setFacts] = useState<Facts | null>(null);
  const [checking, setChecking] = useState(false);

  const run = useCallback(async () => {
    setChecking(true);
    const [connection, start, saved, persisted] = await Promise.all([
      testConnection(),
      startPageSaved(),
      ownerId ? listSaved(ownerId) : Promise.resolve([]),
      navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    setFacts({
      connection,
      start,
      installed: isInstalled(),
      protectedStore: typeof persisted === 'boolean' ? persisted : null,
      chats: savedThreadCount(ownerId),
      books: saved.filter((i) => i.kind === 'BOOK').length,
      docs: saved.filter((i) => i.kind === 'DOC').length,
    });
    setChecking(false);
  }, [ownerId]);

  useEffect(() => {
    void run();
    window.addEventListener('offline-files-changed', run);
    return () => window.removeEventListener('offline-files-changed', run);
  }, [run]);

  async function protect() {
    try {
      await navigator.storage?.persist?.();
    } catch {
      // The browser decides.
    }
    void run();
  }

  if (!facts) return null;

  const rows: { key: string; ok: boolean | null; text: string; fix?: string; action?: JSX.Element }[] = [
    {
      key: 'start',
      ok: facts.start,
      text: facts.start === null ? t('offlineCheck.start_unsupported') : facts.start ? t('offlineCheck.start_ok') : t('offlineCheck.start_no'),
      fix: facts.start === false ? t('offlineCheck.start_fix') ?? undefined : undefined,
    },
    {
      key: 'installed',
      ok: facts.installed,
      text: facts.installed ? t('offlineCheck.installed_ok') : t('offlineCheck.installed_no'),
      fix: facts.installed ? undefined : t('offlineCheck.installed_fix') ?? undefined,
    },
    {
      key: 'safe',
      ok: facts.protectedStore,
      text: facts.protectedStore ? t('offlineCheck.safe_ok') : facts.protectedStore === null ? t('offlineCheck.safe_unknown') : t('offlineCheck.safe_no'),
      action:
        facts.protectedStore === false ? (
          <button type="button" className="btn-secondary mt-1 px-3 py-1 text-xs" onClick={() => void protect()} data-testid="offline-protect">
            {t('offlineCheck.safe_button')}
          </button>
        ) : undefined,
    },
    {
      key: 'chats',
      ok: facts.chats > 0,
      text: facts.chats > 0 ? t('offlineCheck.chats_ok', { count: facts.chats }) : t('offlineCheck.chats_no'),
      fix: facts.chats > 0 ? undefined : t('offlineCheck.chats_fix') ?? undefined,
    },
    {
      key: 'books',
      ok: facts.books > 0,
      text: facts.books > 0 ? t('offlineCheck.books_ok', { count: facts.books }) : t('offlineCheck.books_no'),
      fix: facts.books > 0 ? undefined : t('offlineCheck.books_fix') ?? undefined,
    },
  ];
  // The things that decide whether the app opens at all without internet.
  const problems = rows.filter((r) => r.ok === false && r.key !== 'installed').length;

  return (
    <section className="card space-y-3" data-testid="offline-check">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-brand-900">📶 {t('offlineCheck.title')}</h2>
        <button type="button" className="text-xs text-brand-700 underline disabled:opacity-50" onClick={() => void run()} disabled={checking} data-testid="offline-recheck">
          {t('offlineCheck.recheck')}
        </button>
      </div>
      <p className={`rounded-lg px-3 py-2 text-sm font-medium ${problems === 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`} data-testid="offline-summary">
        {problems === 0 ? t('offlineCheck.summary_ok') : t('offlineCheck.summary_fix', { count: problems })}
      </p>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.key} data-testid={`offline-row-${r.key}`} data-ok={String(r.ok)}>
            <span className="mr-1">{r.ok ? '✅' : r.ok === false ? '⚠️' : '❔'}</span>
            <span className="text-slate-800">{r.text}</span>
            {r.fix && <span className="block pl-6 text-xs text-slate-600">{r.fix}</span>}
            {r.action && <span className="block pl-6">{r.action}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600" data-testid="offline-connection">
        {facts.connection === 'ok' ? t('offlineCheck.net_ok') : facts.connection === 'slow' ? t('offlineCheck.net_slow') : t('offlineCheck.net_none')}
      </p>
    </section>
  );
}
