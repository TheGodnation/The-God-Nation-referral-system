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
