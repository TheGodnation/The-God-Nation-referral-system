import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberLearnPage } from '../pages/MemberLearnPage';
import { MemberAuthProvider, useMemberAuth } from '../lib/MemberAuthContext';
import i18n from '../i18n';

// Offline reading, part two: the Learn page keeps its last list for use without internet,
// signing out removes it, and the PDF engine is part of the app (not a public website).
let online = true;
let EXAM_WORLD: Record<string, unknown>;
const DEFAULT_WORLD = {
  offering: { instructionsEn: null, instructionsFr: null },
  devotionals: [
    { id: 'd1', titleEn: 'Unveiling Kingdom Secrets', titleFr: null, descriptionEn: 'This month\'s book', descriptionFr: null, startDate: '2026-11-01', endDate: '2026-11-30', bookId: 'b1', bookSent: true, iGaveOffering: false, exams: [] },
  ],
  training: { enrollment: 'NONE', books: [] },
};

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!online) throw new TypeError('Failed to fetch');
      const body = url.includes('/api/member/auth/me')
        ? { member: { name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'p1', profileComplete: true } }
        : url.includes('/api/member/exam-world') ? EXAM_WORLD
        : url.includes('/api/settings/public') ? { content: {}, supportWhatsappUrl: null, whatsappGroupEnUrl: null, whatsappGroupFrUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null, youtubeUrl: null, telegramUrl: null, messengerUrl: null }
        : {};
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
    }),
  );
}

// Like the real app (RequireMember): the page is shown only once the member is known.
function Gate({ children }: { children: React.ReactNode }) {
  const { member, loading } = useMemberAuth();
  return loading || !member ? null : <>{children}</>;
}
function page() {
  return render(<MemoryRouter><MemberAuthProvider><Gate><MemberLearnPage /></Gate></MemberAuthProvider></MemoryRouter>);
}

beforeEach(() => { localStorage.clear(); online = true; EXAM_WORLD = DEFAULT_WORLD; i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('Learn page without internet', () => {
  it('online it shows the list and keeps a copy; with no internet it shows that copy, says so, and does not say "could not load"', async () => {
    mockFetch();
    const first = page();
    expect(await screen.findByText('Unveiling Kingdom Secrets')).toBeInTheDocument();
    expect(screen.queryByText(/showing what was saved on this phone/)).toBeNull();
    expect(localStorage.getItem('exam-world:p1')).toContain('Unveiling Kingdom Secrets');
    first.unmount();

    online = false;
    page();
    expect(await screen.findByText('Unveiling Kingdom Secrets')).toBeInTheDocument();
    expect(screen.getByText(/showing what was saved on this phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not load/i)).toBeNull();
  });

  it('with no internet and nothing kept yet, it says it could not load (no crash)', async () => {
    mockFetch();
    online = false;
    // The app opened without internet knows who signed in last on this phone.
    localStorage.setItem('member:last', JSON.stringify({ name: 'Mary', email: 'm@x.com', preferredLanguage: 'en', personId: 'p1', profileComplete: true }));
    page();
    await waitFor(() => expect(screen.getByText(/Could not load/i)).toBeInTheDocument());
  });
});

describe('Learn page with an incomplete answer', () => {
  it('still opens when the answer has no "offering" part (it used to show the error screen)', async () => {
    const { offering: _unused, ...withoutOffering } = DEFAULT_WORLD;
    void _unused;
    EXAM_WORLD = withoutOffering;
    mockFetch();
    page();
    expect(await screen.findByText('Unveiling Kingdom Secrets')).toBeInTheDocument();
  });
});

describe('PDF engine', () => {
  it('is loaded from the app itself first (so the phone keeps it), with the public CDN only as a fallback', async () => {
    const mod = await vi.importActual<typeof import('../lib/loadPdfJs')>('../lib/loadPdfJs');
    expect(mod.PDFJS_WORKER_URL).toBe('/pdfjs/3.11.174/pdf.worker.min.js');
    const appended: string[] = [];
    const orig = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation(((el: any) => {
      appended.push(el.src ?? '');
      if (el.tagName === 'SCRIPT') queueMicrotask(() => el.onerror?.(new Event('error'))); // first (own copy) fails...
      return el;
    }) as any);
    await expect(mod.loadPdfJs()).rejects.toThrow(); // ...then the fallback fails too, so it rejects
    expect(appended[0]).toMatch(/\/pdfjs\/3\.11\.174\/pdf\.min\.js$/);
    expect(appended[1]).toContain('cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    (document.head.appendChild as any).mockRestore?.();
    void orig;
  });
});
