import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { PageNote } from '../components/PageNote';

// The bright-blue note at the top of Home, Learn and Me: stays until closed, remembered per person; on Me it goes by itself
// once both photos are added.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
function signedIn(id = 'p1', daysAgo = 3) {
  const joinedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  vi.stubGlobal('fetch', vi.fn(() => json({ member: { name: 'New Member', email: 'n@x.com', preferredLanguage: 'en', profileComplete: true, termsAccepted: true, personId: id, joinedAt } })));
}
const show = (done = false, id = 'learn') => render(<MemoryRouter><MemberAuthProvider><PageNote id={id} done={done}>Study here</PageNote></MemberAuthProvider></MemoryRouter>);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('page notes', () => {
  it('shows for a signed-in member, is bright blue like the English button, and stays closed once closed', async () => {
    signedIn();
    const first = show();
    const note = await screen.findByTestId('page-note-learn');
    expect(note).toHaveTextContent('Study here');
    expect(note.className).toContain('bg-brand-600');
    fireEvent.click(screen.getByTestId('page-note-close-learn'));
    expect(screen.queryByTestId('page-note-learn')).toBeNull();
    first.unmount();
    show();
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('page-note-learn')).toBeNull();
  });

  it('stays when they leave without closing it, and each page has its own memory', async () => {
    signedIn();
    const first = show(false, 'home');
    await screen.findByTestId('page-note-home');
    first.unmount();
    show(false, 'home');
    expect(await screen.findByTestId('page-note-home')).toBeInTheDocument();
    first.unmount();
    // Closing "learn" earlier does not close "home".
    localStorage.setItem('godnation:note-closed:learn:p1', '1');
    expect(await screen.findByTestId('page-note-home')).toBeInTheDocument();
  });

  it('goes by itself when it is done (both photos added)', async () => {
    signedIn();
    show(true, 'me');
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('page-note-me')).toBeNull();
  });

  it('is only for people who joined in the last 30 days', async () => {
    signedIn('p1', 45);
    show(false, 'learn');
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('page-note-learn')).toBeNull();
  });

  it('shows for someone who joined 29 days ago', async () => {
    signedIn('p1', 29);
    show(false, 'learn');
    expect(await screen.findByTestId('page-note-learn')).toBeInTheDocument();
  });
});
