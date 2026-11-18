import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { MemberChatsPage } from '../pages/MemberChatsPage';

// A new member who lands on Private messages is pointed to Assemblies, where all the members are assembled. The arrow stays
// (even after they leave and come back) until they have tapped Assemblies or closed it.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });

function stub() {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/member/auth/me')) return json({ member: { name: 'New Member', email: 'n@x.com', preferredLanguage: 'en', profileComplete: true, termsAccepted: true, personId: 'p1' } });
    if (url.includes('/api/settings/public')) return json({ content: {} });
    if (url.includes('/community-memberships')) return json({ items: [{ communityId: 'hq', communityName: 'HQ', status: 'ACTIVE', generation: 0 }] });
    if (url.includes('/api/private-messages/conversations')) return json({ items: [{ id: 'c1', createdAt: '2026-11-18T10:00:00Z', otherPartyType: 'LEADER', otherPartyName: 'Welcome Sender', otherPartyPersonId: 'x', unreadCount: 1, lastMessage: null }] });
    return json({ items: [], unreadCount: 0, count: 0 });
  }));
}
const open = () => render(<MemoryRouter><MemberAuthProvider><MemberChatsPage /></MemberAuthProvider></MemoryRouter>);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Arrow pointing a new member to Assemblies', () => {
  it('shows under the tabs while they are on Private messages, and tapping it opens Assemblies and remembers', async () => {
    stub();
    const first = open();
    const hint = await screen.findByTestId('assemblies-hint');
    expect(hint).toHaveTextContent('Tap here to meet where all members of the community are assembled.');
    fireEvent.click(screen.getByTestId('assemblies-hint-go'));
    await waitFor(() => expect(screen.queryByTestId('assemblies-hint')).toBeNull());
    expect(screen.getByRole('tab', { name: /Assemblies/ })).toHaveAttribute('aria-selected', 'true');
    first.unmount();
    // Coming back later: already tapped, so it does not return.
    open();
    await screen.findByRole('tab', { name: /Private messages/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('assemblies-hint')).toBeNull();
  });

  it('stays when they leave without tapping it, and returns when they come back', async () => {
    stub();
    const first = open();
    await screen.findByTestId('assemblies-hint');
    first.unmount();
    open();
    expect(await screen.findByTestId('assemblies-hint')).toBeInTheDocument();
  });

  it('can be closed with the ✕, and then stays closed', async () => {
    stub();
    const first = open();
    await screen.findByTestId('assemblies-hint');
    fireEvent.click(screen.getByTestId('assemblies-hint-close'));
    expect(screen.queryByTestId('assemblies-hint')).toBeNull();
    first.unmount();
    open();
    await screen.findByRole('tab', { name: /Private messages/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('assemblies-hint')).toBeNull();
  });
});
