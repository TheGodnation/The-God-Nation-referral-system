import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FollowUpsTab } from '../components/admin/FollowUpsTab';

// Central Authority Follow-Up Attention — the "Needs Attention" section
// added to the existing Admin Follow-Ups tab. Same URL-dispatching fetch
// mock pattern established across prior admin-tab client tests (e.g.
// FollowUpsTab.test.tsx itself). Read-only: no action button, no form —
// unlike the Leader's own "My Follow-Up" attention list, which offers a
// "Log Contact" action.
const EMPTY_LIST = { status: 200, body: { items: [], pagination: { totalPages: 1 } } };

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
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
});

describe('FollowUpsTab (Admin) — Needs Attention', () => {
  it('shows a loading state while the attention list is being fetched', () => {
    mockFetchByUrl({ '/api/admin/follow-ups': EMPTY_LIST, '/api/admin/follow-ups/attention': EMPTY_LIST });
    render(<FollowUpsTab />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the empty state when nothing needs attention', async () => {
    mockFetchByUrl({ '/api/admin/follow-ups': EMPTY_LIST, '/api/admin/follow-ups/attention': EMPTY_LIST });
    render(<FollowUpsTab />);
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
  });

  it('shows an error state when the attention request fails', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': EMPTY_LIST,
      '/api/admin/follow-ups/attention': { status: 500, body: { error: 'boom' } },
    });
    render(<FollowUpsTab />);
    expect(await screen.findByText('Failed to load the attention list.')).toBeInTheDocument();
  });

  it('renders every attention reason, Community, follower, and contact dates', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': EMPTY_LIST,
      '/api/admin/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'fu-1',
              followerPersonId: 'leader-1',
              followerName: 'Mary Leader',
              personId: 'person-1',
              name: 'Jane Emergency',
              communityId: 'community-1',
              communityName: 'Youth Ministry',
              reason: 'EMERGENCY',
              lastContactedAt: '2026-01-01T00:00:00.000Z',
              nextFollowUpDate: '2026-01-10T00:00:00.000Z',
            },
            {
              followUpAssignmentId: 'fu-2',
              followerPersonId: 'leader-2',
              followerName: 'John Leader',
              personId: 'person-2',
              name: 'Paul NotYet',
              communityId: 'community-2',
              communityName: 'Prayer Group',
              reason: 'NOT_YET_CONTACTED',
              lastContactedAt: null,
              nextFollowUpDate: null,
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<FollowUpsTab />);

    expect(await screen.findByText('Jane Emergency')).toBeInTheDocument();
    expect(screen.getByText('Emergency')).toBeInTheDocument();
    expect(screen.getByText(/Youth Ministry/)).toBeInTheDocument();
    expect(screen.getByText(/Mary Leader/)).toBeInTheDocument();
    expect(screen.getByText(/Last contacted/)).toBeInTheDocument();
    expect(screen.getByText(/next follow-up/)).toBeInTheDocument();

    expect(screen.getByText('Paul NotYet')).toBeInTheDocument();
    // "Not yet contacted" is both the reason badge label and the
    // no-contact-yet line's own text — genuinely appears twice for this
    // one item, same as the identical Leader-side wording precedent.
    expect(screen.getAllByText('Not yet contacted').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Prayer Group/)).toBeInTheDocument();
    expect(screen.getByText(/John Leader/)).toBeInTheDocument();
  });

  it('French labels render correctly', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((fr.default as any).admin.followUps.attention_title).toBe('Nécessite une attention');
    expect((fr.default as any).admin.followUps.attention_reason_emergency).toBe('Urgence');
    expect((fr.default as any).admin.followUps.attention_empty).toBe('Rien ne nécessite d\'attention pour le moment.');
    expect((en.default as any).admin.followUps.attention_title).toBe('Needs Attention');
  });

  it('does not offer a "Log Contact" action or any write control in the attention list (read-only)', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': EMPTY_LIST,
      '/api/admin/follow-ups/attention': {
        status: 200,
        body: {
          items: [
            {
              followUpAssignmentId: 'fu-1',
              followerPersonId: 'leader-1',
              followerName: 'Mary Leader',
              personId: 'person-1',
              name: 'Jane Emergency',
              communityId: 'community-1',
              communityName: 'Youth Ministry',
              reason: 'EMERGENCY',
              lastContactedAt: null,
              nextFollowUpDate: null,
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<FollowUpsTab />);
    await screen.findByText('Jane Emergency');
    expect(screen.queryByText('Log Contact')).not.toBeInTheDocument();
  });

  it('existing Follow-Up list/create functionality remains intact alongside the new attention section', async () => {
    mockFetchByUrl({
      '/api/admin/follow-ups': {
        status: 200,
        body: {
          items: [
            {
              id: 'assignment-1',
              status: 'ACTIVE',
              contextType: 'COMMUNITY',
              contextId: 'community-1',
              assignedAt: '2026-01-01T00:00:00.000Z',
              closedAt: null,
              closeReason: null,
              follower: { id: 'leader-1', name: 'Mary Leader' },
              followedPerson: { id: 'person-1', name: 'Jane Doe' },
              assignedBy: { id: 'admin-1', name: 'Admin', email: 'admin@test.local' },
              closedBy: null,
              contacts: [],
            },
          ],
          pagination: { totalPages: 1 },
        },
      },
      '/api/admin/follow-ups/attention': EMPTY_LIST,
    });

    render(<FollowUpsTab />);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('+ New Follow-Up')).toBeInTheDocument();
  });
});
