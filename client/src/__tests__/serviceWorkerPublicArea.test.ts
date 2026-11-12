// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The installed app's service worker must leave the public website (/en/… and /fr/…)
// alone. Today it saves ANY successful page as the app's offline start page, so a public
// article would replace the app when the app is opened without internet. These tests run the
// real worker file in a sandbox and check what it does for app pages, public pages, guides and
// the API, online and offline.

const SW_SOURCE = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://thegodnationacademy.org';

function makeWorker(opts: { online: boolean; html?: Record<string, string> }) {
  const state = { online: opts.online, hang: false };
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, any>>();
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (k: any) => m.get(typeof k === 'string' ? k : new URL(k.url).pathname),
      put: async (k: any, v: any) => void m.set(typeof k === 'string' ? k : new URL(k.url).pathname, v),
      keys: async () => [...m.keys()],
      delete: async (k: any) => m.delete(k),
    };
  };
  const fetched: string[] = [];
  const sandbox: any = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: any) => { handlers[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
      registration: { showNotification: async () => {} },
    },
    caches: { open: async (n: string) => cacheOf(n), keys: async () => [...stores.keys()], delete: async () => true },
    fetch: async (req: any) => {
      const u = new URL(typeof req === 'string' ? req : req.url);
      fetched.push(u.pathname);
      // A network that says it is connected but never answers.
      if (state.hang) return new Promise(() => {});
      if (!state.online) throw new TypeError('offline');
      const body = opts.html?.[u.pathname] ?? `<html><body>PAGE ${u.pathname}</body></html>`;
      const res = new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      // A real network answer to a same-site page load has type "basic".
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    },
    Response, URL, Promise, console, Symbol, setTimeout, clearTimeout,
  };
  vm.runInNewContext(SW_SOURCE, sandbox);
  async function navigate(pathname: string) {
    const slot: { promise: Promise<any> | null } = { promise: null };
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: ORIGIN + pathname }, respondWith: (p: Promise<any>) => { slot.promise = p; } });
    const res = slot.promise ? await slot.promise : null;
    return { handled: slot.promise !== null, text: res ? await res.text() : null };
  }
  const shell = async () => {
    const hit = await cacheOf('god-nation-shell-v1').match('/__offline-shell');
    return hit ? await hit.clone().text() : null;
  };
  return { navigate, shell, fetched, setOnline: (v: boolean) => { state.online = v; }, setHang: (v: boolean) => { state.hang = v; } };
}

afterEach(() => vi.useRealTimers());

describe('Service worker and the public website', () => {
  it('does not handle page loads in /en/ or /fr/ (nor /en, /fr themselves)', async () => {
    const w = makeWorker({ online: true });
    for (const p of ['/en/', '/fr/', '/en', '/fr', '/en/knowledge/kingdom-knowledge/a/', '/fr/connaissance/x/y/']) {
      expect((await w.navigate(p)).handled, p).toBe(false);
    }
    expect(w.fetched).toEqual([]);
  });

  it('still handles the app\'s own pages exactly as before, and keeps its offline start page', async () => {
    const w = makeWorker({ online: true });
    for (const p of ['/', '/member/chats', '/member/login', '/privacy', '/page/about', '/en-route-something']) {
      const r = await w.navigate(p);
      expect(r.handled, p).toBe(true);
      expect(r.text).toContain('PAGE ' + p);
    }
    expect(await w.shell()).toContain('PAGE /en-route-something');
  });

  it('a public page opened after an app page does not replace the saved offline start page', async () => {
    const w = makeWorker({ online: true });
    await w.navigate('/member/chats');
    const before = await w.shell();
    await w.navigate('/en/knowledge/kingdom-knowledge/a/');
    await w.navigate('/fr/connaissance/connaissance-du-royaume/b/');
    expect(await w.shell()).toBe(before);
    expect(before).toContain('PAGE /member/chats');
  });

  it('offline, an app page still comes from the saved start page (offline reading keeps working)', async () => {
    const w = makeWorker({ online: true });
    await w.navigate('/member/learn'); // an ordinary visit while online
    w.setOnline(false);
    const r = await w.navigate('/member/downloads');
    expect(r.handled).toBe(true);
    expect(r.text).toContain('PAGE /member/learn'); // the app's saved start page, not an error
  });

  it('the exact sequence that failed on the prototype: read a public article online, then open the app offline', async () => {
    const w = makeWorker({ online: true });
    await w.navigate('/');                                         // the app, online
    await w.navigate('/en/knowledge/kingdom-knowledge/a/');        // a public article, online (last page opened)
    w.setOnline(false);
    const app = await w.navigate('/member/chats');                 // open the installed app with no internet
    expect(app.text).toContain('PAGE /');                          // the app's start page...
    expect(app.text).not.toContain('/en/knowledge');               // ...never the article
    expect((await w.navigate('/en/knowledge/kingdom-knowledge/a/')).handled).toBe(false); // the public page is the browser's business
  });

  it('on a network that never answers, shows the saved start page after a few seconds instead of hanging', async () => {
    vi.useFakeTimers();
    const w = makeWorker({ online: true });
    await w.navigate('/member/learn'); // an ordinary visit: the start page is saved
    w.setHang(true);
    const pending = w.navigate('/member/chats');
    await vi.advanceTimersByTimeAsync(3900);
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false); // still waiting for the network, as before
    await vi.advanceTimersByTimeAsync(300);
    const r = await pending;
    expect(r.handled).toBe(true);
    expect(r.text).toContain('PAGE /member/learn'); // the saved start page
  });

  it('with no saved start page yet, it keeps waiting for the network (nothing to show instead)', async () => {
    vi.useFakeTimers();
    const w = makeWorker({ online: true });
    w.setHang(true);
    let done = false;
    void w.navigate('/member/chats').then(() => (done = true));
    await vi.advanceTimersByTimeAsync(20000);
    expect(done).toBe(false);
  });

  it('keeps ignoring the API and the four guide folders', async () => {
    const w = makeWorker({ online: true });
    for (const p of ['/api/health', '/api/member/auth/me', '/leader-guide/', '/no-app-guide/', '/notifications-guide/', '/phone-settings-guide/']) {
      expect((await w.navigate(p)).handled, p).toBe(false);
    }
  });

  it('declares the public roots in the source, next to the guide list', () => {
    expect(SW_SOURCE).toContain("const PUBLIC_SITE_ROOTS = ['/en', '/fr'];");
    expect(SW_SOURCE).toContain("const GUIDE_PREFIXES = ['/leader-guide/', '/notifications-guide/', '/phone-settings-guide/', '/no-app-guide/'];");
  });
});
