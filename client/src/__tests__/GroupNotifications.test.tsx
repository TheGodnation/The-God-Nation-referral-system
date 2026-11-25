import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupNotifications } from '../components/assembly/GroupNotifications';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const data = {
  total: 3,
  on: 1,
  members: [
    { personId: 'p-off-1', name: 'Bertha Off', photoUrl: null, on: false, phones: 0, isYou: false },
    { personId: 'p-off-2', name: 'Carl Off', photoUrl: null, on: false, phones: 0, isYou: false },
    { personId: 'p-on', name: 'Ada On', photoUrl: null, on: true, phones: 1, isYou: false },
  ],
};

describe('Notifications in a group (for the administrator)', () => {
  it('shows how many members have notifications on, who has not yet, and sends a test alert to one member', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return json({ devices: 1, sent: 1, expired: 0, failed: 0 });
      }
      return json(data);
    }));
    render(<MemoryRouter><GroupNotifications communityId="g1" /></MemoryRouter>);
    expect(await screen.findByTestId('group-notifications-count')).toHaveTextContent('1 of 3 members have notifications on.');
    fireEvent.click(screen.getByTestId('group-notifications-off'));
    const offList = screen.getByTestId('group-notifications-list');
    expect(within(offList).getAllByRole('link').map((a) => a.textContent)).toEqual(['Bertha Off', 'Carl Off']);
    expect(within(offList).queryByTestId('group-notifications-test')).toBeNull(); // nothing to test on a phone without notifications
    fireEvent.click(screen.getByTestId('group-notifications-on'));
    fireEvent.click(screen.getByTestId('group-notifications-test'));
    await waitFor(() => expect(screen.getByTestId('group-notifications-result')).toHaveTextContent('Test alert sent to their phone'));
    expect(posts).toEqual([{ personId: 'p-on' }]);
  });

  it('shows nothing to someone who is not the administrator', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'Only the group administrator can see this.' }, 403)));
    render(<MemoryRouter><GroupNotifications communityId="g1" /></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('group-notifications')).toBeNull();
  });
});
