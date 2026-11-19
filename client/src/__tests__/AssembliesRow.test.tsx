import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { MemberChatsPage } from '../pages/MemberChatsPage';

// A new member who lands on Private messages sees one slim row above them that points to Assemblies, where the whole
// community gathers. It stays until they open Assemblies, and is only for people who joined in the last 30 days.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });

function stub(daysAgo = 3) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/member/auth/me')) return json({ member: { name: 'New Member', email: 'n@x.com', preferredLanguage: 'en', profileComplete: true, termsAccepted: true, personId: 'p1', joinedAt: new Date(Date.now() - daysAgo * 86400000).toISOString() } });
    if (url.includes('/api/settings/public')) return json({ content: {} });
    if (url.includes('/community-memberships')) return json({ items: [{ communityId: 'hq', communityName: '|| HQ ASSEMBLY ||', status: 'ACTIVE', generation: 0 }] });
    if (url.includes('/api/private-messages/conversations')) return json({ items: [{ id: 'c1', createdAt: '2026-11-18T10:00:00Z', otherPartyType: 'LEADER', otherPartyName: 'Welcome Sender', otherPartyPersonId: 'x', unreadCount: 1, lastMessage: null }] });
    return json({ items: [], unreadCount: 0, count: 0 });
  }));
}
const open = () => render(<MemoryRouter><MemberAuthProvider><MemberChatsPage /></MemberAuthProvider></MemoryRouter>);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Assemblies row above the private messages', () => {
  it('shows above the first private message with the assembly name, and tapping it opens Assemblies and remembers', async () => {
    stub();
    const first = open();
    const row = await screen.findByTestId('assemblies-row');
    expect(row).toHaveTextContent('Tap here to access where the whole community gathers.');
    // It comes before the private message in the page.
    const message = await screen.findByText('Welcome Sender');
    expect(row.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId('assemblies-row')).toBeNull());
    expect(screen.getByRole('tab', { name: /Assemblies/ })).toHaveAttribute('aria-selected', 'true');
    first.unmount();
    open();
    await screen.findByRole('tab', { name: /Private messages/ });
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('assemblies-row')).toBeNull();
  });

  it('stays when they leave without opening Assemblies, and comes back', async () => {
    stub();
    const first = open();
    await screen.findByTestId('assemblies-row');
    first.unmount();
    open();
    expect(await screen.findByTestId('assemblies-row')).toBeInTheDocument();
  });

  it('is not shown to a member who joined more than 30 days ago', async () => {
    stub(90);
    open();
    await screen.findByText('Welcome Sender');
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('assemblies-row')).toBeNull();
  });
});
