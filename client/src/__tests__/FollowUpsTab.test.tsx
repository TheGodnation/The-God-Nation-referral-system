import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FollowUpsTab } from '../components/admin/FollowUpsTab';

// Geography Retirement Step 5A — Admin Follow-Up oversight. Same
// URL-dispatching fetch mock pattern established across prior admin-tab
// client tests (e.g. AnnouncementsTab.test.tsx). Before this step, the
// create form offered a Community/Geography scope-type selector; Follow-Up
// is now Community-scoped only, so that selector is gone entirely.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('FollowUpsTab (Admin) — Geography Retirement Step 5A', () => {
  it('the create form offers no scope-type selector and no Geography option at all', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<FollowUpsTab />);

    fireEvent.click(await screen.findByText('+ New Follow-Up'));

    expect(screen.queryByText('Geography')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search communities by name')).toBeInTheDocument();
    // The only pre-existing combobox is the unrelated status filter
    // (All/Active/Closed) — no scope-type selector was added back in its
    // place.
    const comboboxOptionSets = screen.getAllByRole('combobox').map((el) => el.textContent);
    expect(comboboxOptionSets).toEqual([expect.stringContaining('All')]);
  });

  it('creates a follow-up with COMMUNITY contextType and reloads the list', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/people?search=': {
        status: 200,
        body: { items: [{ id: 'person-1', name: 'Jane Doe', whatsappNumber: '+237600000001' }] },
      },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
    });

    render(<FollowUpsTab />);

    fireEvent.click(await screen.findByText('+ New Follow-Up'));

    // Follower (first person picker) and Followed Person (second) share the
    // same placeholder/label text — picked by DOM order, same convention as
    // the rest of this codebase's multi-picker admin forms.
    const personInputs = screen.getAllByPlaceholderText('Search by name or WhatsApp number');
    fireEvent.change(personInputs[0], { target: { value: 'Jane' } });
    fireEvent.click(screen.getAllByText('Search')[0]);
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(1));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'person-1' } });
    fireEvent.click(screen.getAllByText('Select')[0]);

    const remainingPersonInput = screen.getAllByPlaceholderText('Search by name or WhatsApp number')[0];
    fireEvent.change(remainingPersonInput, { target: { value: 'Jane' } });
    fireEvent.click(screen.getAllByText('Search')[0]);
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(1));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'person-1' } });
    fireEvent.click(screen.getAllByText('Select')[0]);

    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBe(1));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'community-1' } });
    fireEvent.click(screen.getByText('Select'));

    fireEvent.click(screen.getByText('Create Follow-Up'));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/follow-ups');
      expect(createCall).toBeTruthy();
      expect((createCall!.body as any).contextType).toBe('COMMUNITY');
      expect((createCall!.body as any).contextId).toBe('community-1');
    });
  });
});

describe('FollowUpsTab (Admin) — bulk distribute', () => {
  it('picks a Community and at least two Leaders, submits, and shows the result summary', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
      '/api/admin/people?search=leader1': { status: 200, body: { items: [{ id: 'leader-1', name: 'Leader One', whatsappNumber: '+237600000001' }] } },
      '/api/admin/people?search=leader2': { status: 200, body: { items: [{ id: 'leader-2', name: 'Leader Two', whatsappNumber: '+237600000002' }] } },
      '/api/admin/follow-ups/bulk-distribute': {
        status: 201,
        body: {
          totalEligible: 3,
          totalAssigned: 3,
          skippedAlreadyFollowed: 1,
          perLeader: [
            { followerId: 'leader-1', count: 2 },
            { followerId: 'leader-2', count: 1 },
          ],
        },
      },
    });

    render(<FollowUpsTab />);
    fireEvent.click(await screen.findByText('Bulk Distribute'));

    // Both the Community picker and the Leaders picker are visible at once
    // here, each with their own "Search" button — the Community one is
    // first in DOM order. Each selection is targeted via the option it
    // produces rather than a global combobox count, since this page also
    // always renders its own unrelated status-filter <select>.
    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getAllByText('Search')[0]);
    const communityOption = await screen.findByRole('option', { name: 'Youth Ministry' });
    fireEvent.change(communityOption.closest('select')!, { target: { value: 'community-1' } });
    fireEvent.click(screen.getByText('Select'));

    const leaderInput = screen.getByPlaceholderText('Search by name or WhatsApp number');
    fireEvent.change(leaderInput, { target: { value: 'leader1' } });
    fireEvent.click(screen.getByText('Search'));
    const leaderOneOption = await screen.findByRole('option', { name: 'Leader One (+237600000001)' });
    fireEvent.change(leaderOneOption.closest('select')!, { target: { value: 'leader-1' } });
    fireEvent.click(screen.getByText('+ Add Leader'));
    await screen.findByText('Leader One');

    fireEvent.change(leaderInput, { target: { value: 'leader2' } });
    fireEvent.click(screen.getByText('Search'));
    const leaderTwoOption = await screen.findByRole('option', { name: 'Leader Two (+237600000002)' });
    fireEvent.change(leaderTwoOption.closest('select')!, { target: { value: 'leader-2' } });
    fireEvent.click(screen.getByText('+ Add Leader'));
    await screen.findByText('Leader Two');

    fireEvent.click(screen.getByText('Distribute'));

    await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/follow-ups/bulk-distribute');
      expect(call).toBeTruthy();
      expect(call!.body).toEqual({ contextType: 'COMMUNITY', contextId: 'community-1', followerPersonIds: ['leader-1', 'leader-2'] });
    });

    expect(await screen.findByText('3 follow-ups created. 1 people already had a follower and were left unchanged.')).toBeInTheDocument();
    expect(screen.getByText('Leader One: 2')).toBeInTheDocument();
    expect(screen.getByText('Leader Two: 1')).toBeInTheDocument();
  });

  it('disables Distribute until a Community and at least two Leaders are chosen', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<FollowUpsTab />);
    fireEvent.click(await screen.findByText('Bulk Distribute'));

    expect(screen.getByText('Distribute')).toBeDisabled();
  });
});
