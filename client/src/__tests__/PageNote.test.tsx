import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { PageNote } from '../components/PageNote';

// The slim line at the top of Home, Learn and Me: always visible for people who joined in the last 30 days (nothing to
// tap to see it), tappable to go there, and on Me it goes by itself once both photos are added.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
function signedIn(daysAgo = 3) {
  const joinedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  vi.stubGlobal('fetch', vi.fn(() => json({ member: { name: 'New Member', email: 'n@x.com', preferredLanguage: 'en', profileComplete: true, termsAccepted: true, personId: 'p1', joinedAt } })));
}
const show = (props: Partial<React.ComponentProps<typeof PageNote>> = {}) =>
  render(
    <MemoryRouter>
      <MemberAuthProvider>
        <Routes>
          <Route path="/" element={<><div id="target">Target</div><PageNote id="learn" scrollTo="target" {...props}>Study here</PageNote></>} />
          <Route path="/member/me/edit" element={<p>Edit profile screen</p>} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('page notes', () => {
  it('is visible without any tap for a member who joined recently, and has no close button to lose it', async () => {
    signedIn();
    show();
    const note = await screen.findByTestId('page-note-learn');
    expect(note).toHaveTextContent('Study here');
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('scrolls to the content when tapped', async () => {
    signedIn();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Study here/ }));
    expect(scroll).toHaveBeenCalled();
  });

  it('can open another screen when tapped (Me opens the profile edit screen)', async () => {
    signedIn();
    show({ to: '/member/me/edit' });
    fireEvent.click(await screen.findByRole('link', { name: /Study here/ }));
    expect(await screen.findByText('Edit profile screen')).toBeInTheDocument();
  });

  it('is only for people who joined in the last 30 days', async () => {
    signedIn(45);
    show();
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('page-note-learn')).toBeNull();
  });

  it('shows for someone who joined 29 days ago, and goes by itself when it is done (both photos added)', async () => {
    signedIn(29);
    const first = show();
    expect(await screen.findByTestId('page-note-learn')).toBeInTheDocument();
    first.unmount();
    show({ done: true });
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('page-note-learn')).toBeNull();
  });
});
