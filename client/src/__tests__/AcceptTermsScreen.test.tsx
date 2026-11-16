import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequireMember } from '../components/RequireMember';

const state: { member: Record<string, unknown> | null } = { member: null };
const refresh = vi.fn(async () => {
  state.member = { ...state.member, termsAccepted: true };
});
const logout = vi.fn(async () => {});
vi.mock('../lib/MemberAuthContext', () => ({
  useMemberAuth: () => ({ member: state.member, loading: false, refresh, logout }),
}));
// The extras RequireMember mounts around a screen are not what this test is about.
vi.mock('../components/member/PresencePing', () => ({ PresencePing: () => null }));
vi.mock('../components/member/ConnectionBar', () => ({ ConnectionBar: () => null }));
vi.mock('../components/member/OfflinePrefetch', () => ({ OfflinePrefetch: () => null }));
vi.mock('../components/member/WelcomeBackBanner', () => ({ WelcomeBackBanner: () => null }));

const calls: { url: string; method: string; body?: unknown }[] = [];
function mockFetch(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => (status < 300 ? { termsAccepted: true } : { error: 'Nope' }) });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  refresh.mockClear();
  logout.mockClear();
});

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/member/chats']}>
      <RequireMember>
        <p>Chats here</p>
      </RequireMember>
    </MemoryRouter>,
  );
}

describe('One-time Terms screen', () => {
  it('a member who has not accepted sees the Terms screen instead of the app, and must tick the box', async () => {
    state.member = { name: 'Ada', personId: 'p1', profileComplete: true, termsAccepted: false };
    mockFetch();
    const view = renderGate();
    expect(screen.getByTestId('accept-terms-screen')).toBeInTheDocument();
    expect(screen.queryByText('Chats here')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');

    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please tick the box');
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ method: 'POST', body: { accept: true } });
    expect(calls[0].url).toContain('/api/member/auth/accept-terms');
    view.rerender(
      <MemoryRouter initialEntries={['/member/chats']}>
        <RequireMember>
          <p>Chats here</p>
        </RequireMember>
      </MemoryRouter>,
    );
    expect(screen.getByText('Chats here')).toBeInTheDocument();
  });

  it('they can sign out instead', () => {
    state.member = { name: 'Ada', personId: 'p1', profileComplete: true, termsAccepted: false };
    renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('a member who accepted, or whose answer is unknown (offline copy), goes straight in', () => {
    for (const termsAccepted of [true, undefined]) {
      state.member = { name: 'Ada', personId: 'p1', profileComplete: true, termsAccepted };
      const { unmount } = renderGate();
      expect(screen.getByText('Chats here')).toBeInTheDocument();
      unmount();
    }
  });
});
