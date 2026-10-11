import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotificationBell } from '../components/NotificationBell';

// In-App Notifications Foundation — the shared notification bell used
// identically across the Admin/Leader/Member dashboards. Same
// URL-dispatching fetch mock pattern established across every other
// admin/leader-tab client test in this codebase.
function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
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

describe('NotificationBell — unread count', () => {
  it('shows the unread count badge from the server on mount', async () => {
    mockFetchByUrl({ '/api/notifications/unread-count': { status: 200, body: { unreadCount: 3 } } });
    render(<NotificationBell />);
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('shows no badge when the unread count is zero', async () => {
    mockFetchByUrl({ '/api/notifications/unread-count': { status: 200, body: { unreadCount: 0 } } });
    render(<NotificationBell />);
    await waitFor(() => expect(screen.queryByText('0')).not.toBeInTheDocument());
  });
});

describe('NotificationBell — notification display', () => {
  it('renders each of the four notification types with the correct interpolated message', async () => {
    mockFetchByUrl({
      '/api/notifications/unread-count': { status: 200, body: { unreadCount: 4 } },
      '/api/notifications': {
        status: 200,
        body: {
          items: [
            { id: 'n1', type: 'FOLLOW_UP_ASSIGNED', metadata: { followedPersonName: 'Jane Doe' }, targetType: 'FollowUpAssignment', targetId: 'fu1', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'n2', type: 'PRIVATE_MESSAGE_RECEIVED', metadata: { senderName: 'Mary Leader' }, targetType: 'PrivateConversation', targetId: 'pc1', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'n3', type: 'RESOURCE_GRANTED', metadata: { resourceTitleEn: 'Leadership Guide', resourceTitleFr: 'Guide du leadership' }, targetType: 'ResourceAccessGrant', targetId: 'rg1', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'n4', type: 'ROLE_ASSIGNED', metadata: { communityName: 'Youth Ministry' }, targetType: 'RoleAssignment', targetId: 'ra1', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));

    expect(await screen.findByText('New Follow-Up: Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('New message from Mary Leader')).toBeInTheDocument();
    expect(screen.getByText('You now have access to: Leadership Guide')).toBeInTheDocument();
    expect(screen.getByText('You are now a Leader for Youth Ministry')).toBeInTheDocument();
  });

  it('renders the Central Authority label for a private message with no sender name', async () => {
    mockFetchByUrl({
      '/api/notifications/unread-count': { status: 200, body: { unreadCount: 1 } },
      '/api/notifications': {
        status: 200,
        body: {
          items: [
            { id: 'n1', type: 'PRIVATE_MESSAGE_RECEIVED', metadata: { senderName: null }, targetType: 'PrivateConversation', targetId: 'pc1', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          pagination: { totalPages: 1 },
        },
      },
    });

    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    expect(await screen.findByText('New message from Central Authority')).toBeInTheDocument();
  });
});

describe('NotificationBell — read state', () => {
  it('marks an unread notification read on click and decrements the badge', async () => {
    mockFetchByUrl({
      '/api/notifications/unread-count': { status: 200, body: { unreadCount: 1 } },
      '/api/notifications': {
        status: 200,
        body: {
          items: [
            { id: 'n1', type: 'FOLLOW_UP_ASSIGNED', metadata: { followedPersonName: 'Jane Doe' }, targetType: null, targetId: null, readAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
          pagination: { totalPages: 1 },
        },
      },
      '/api/notifications/n1/read': { status: 200, body: { id: 'n1', readAt: '2026-01-02T00:00:00.000Z' } },
    });

    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    const item = await screen.findByText('New Follow-Up: Jane Doe');

    fireEvent.click(item);

    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
  });
});

describe('NotificationBell — empty/loading/error states', () => {
  it('shows the empty state when there are no notifications', async () => {
    mockFetchByUrl({
      '/api/notifications/unread-count': { status: 200, body: { unreadCount: 0 } },
      '/api/notifications': { status: 200, body: { items: [], pagination: { totalPages: 1 } } },
    });

    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
  });

  it('shows a loading state while the list is being fetched', async () => {
    mockFetchByUrl({ '/api/notifications/unread-count': { status: 200, body: { unreadCount: 0 } } });
    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state when the list request fails', async () => {
    mockFetchByUrl({
      '/api/notifications/unread-count': { status: 200, body: { unreadCount: 0 } },
      '/api/notifications': { status: 500, body: { error: 'boom' } },
    });

    render(<NotificationBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    expect(await screen.findByText('Failed to load notifications.')).toBeInTheDocument();
  });
});

describe('NotificationBell — i18n', () => {
  it('English and French notification strings exist and match', async () => {
    const en = await import('../i18n/en.json');
    const fr = await import('../i18n/fr.json');
    expect((en.default as any).notifications.title).toBe('Notifications');
    expect((fr.default as any).notifications.title).toBe('Notifications');
    expect((en.default as any).notifications.empty).toBe('You have no notifications yet.');
    expect((fr.default as any).notifications.empty).toBe("Vous n'avez aucune notification pour le moment.");
    expect((en.default as any).notifications.follow_up_assigned).toBe('New Follow-Up: {{name}}');
    expect((fr.default as any).notifications.follow_up_assigned).toBe('Nouveau suivi : {{name}}');
  });
});
