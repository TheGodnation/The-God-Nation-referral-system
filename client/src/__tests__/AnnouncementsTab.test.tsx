import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnnouncementsTab } from '../components/admin/AnnouncementsTab';

// Phase 3M.3 — Admin announcement management. Same URL-dispatching fetch
// mock pattern established across prior admin-tab client tests (e.g.
// RoleAssignmentsTabLeadershipProposals.test.tsx, CommunityGeographyReparenting.test.tsx).
const calls: { url: string; method: string; body: unknown }[] = [];

const DRAFT_ROW = {
  id: 'ann-1',
  titleEn: 'Draft Announcement',
  titleFr: null,
  bodyEn: 'Draft body.',
  bodyFr: null,
  createdAt: '2026-01-01T00:00:00Z',
  publishedAt: null,
  archivedAt: null,
  createdBy: { id: 'admin-1', email: 'admin@test.local' },
  targets: [{ id: 't1', communityId: 'community-1', communityName: 'Youth Ministry', geographyId: null, geographyName: null }],
};

const PUBLISHED_ROW = {
  ...DRAFT_ROW,
  id: 'ann-2',
  titleEn: 'Published Announcement',
  publishedAt: '2026-01-05T00:00:00Z',
};

const ARCHIVED_ROW = {
  ...DRAFT_ROW,
  id: 'ann-3',
  titleEn: 'Archived Announcement',
  publishedAt: '2026-01-02T00:00:00Z',
  archivedAt: '2026-01-06T00:00:00Z',
};

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

describe('AnnouncementsTab (Admin)', () => {
  it('lists announcements with title, status, and target summary', async () => {
    mockFetchByUrl({
      '/api/admin/announcements': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<AnnouncementsTab />);

    await waitFor(() => {
      expect(screen.getByText('Draft Announcement')).toBeInTheDocument();
    });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Youth Ministry')).toBeInTheDocument();
  });

  it('shows Edit and Publish for a draft, but only Archive for a published row, and neither for an archived row', async () => {
    mockFetchByUrl({
      '/api/admin/announcements': {
        status: 200,
        body: { items: [DRAFT_ROW, PUBLISHED_ROW, ARCHIVED_ROW], pagination: { totalPages: 1 } },
      },
    });

    render(<AnnouncementsTab />);

    await waitFor(() => {
      expect(screen.getByText('Draft Announcement')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText('Edit');
    expect(editButtons).toHaveLength(1);
    const publishButtons = screen.getAllByText('Publish');
    expect(publishButtons).toHaveLength(1);
    const archiveButtons = screen.getAllByText('Archive');
    // Draft and Published rows both get Archive; the archived row does not.
    expect(archiveButtons).toHaveLength(2);
  });

  it('creates a draft with a Community target and reloads the list', async () => {
    mockFetchByUrl({
      '/api/admin/announcements': {
        status: 200,
        body: { items: [], pagination: { totalPages: 1 } },
      },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
    });

    render(<AnnouncementsTab />);

    fireEvent.click(await screen.findByText('+ New Announcement'));

    fireEvent.change(screen.getByLabelText('Title (English)'), { target: { value: 'New Draft' } });
    fireEvent.change(screen.getByLabelText('Body (English)'), { target: { value: 'New body.' } });

    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
    });
    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[comboboxes.length - 1], { target: { value: 'community-1' } });
    fireEvent.click(screen.getByText('Add Target'));

    expect(screen.getAllByText(/Youth Ministry/).length).toBeGreaterThan(0);
    expect(screen.getByText('Remove')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Create Draft'));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/admin/announcements') && !c.url.includes('publish') && !c.url.includes('archive'));
      expect(createCall).toBeTruthy();
      expect((createCall!.body as any).titleEn).toBe('New Draft');
      expect((createCall!.body as any).targets).toEqual([{ communityId: 'community-1' }]);
    });
  });

  it('publishes a draft', async () => {
    mockFetchByUrl({
      '/api/admin/announcements/ann-1/publish': { status: 200, body: { ...DRAFT_ROW, publishedAt: '2026-02-01T00:00:00Z' } },
      '/api/admin/announcements': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<AnnouncementsTab />);

    fireEvent.click(await screen.findByText('Publish'));

    await waitFor(() => {
      const publishCall = calls.find((c) => c.method === 'POST' && c.url.includes('/publish'));
      expect(publishCall).toBeTruthy();
    });
  });

  it('archives an announcement after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetchByUrl({
      '/api/admin/announcements/ann-1/archive': { status: 200, body: { ...DRAFT_ROW, archivedAt: '2026-02-01T00:00:00Z' } },
      '/api/admin/announcements': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<AnnouncementsTab />);

    fireEvent.click(await screen.findByText('Archive'));

    await waitFor(() => {
      const archiveCall = calls.find((c) => c.method === 'POST' && c.url.includes('/archive'));
      expect(archiveCall).toBeTruthy();
    });
  });

  it('opens the edit form pre-filled for a draft and saves via PATCH', async () => {
    mockFetchByUrl({
      '/api/admin/announcements/ann-1': { status: 200, body: { ...DRAFT_ROW, titleEn: 'Edited Title' } },
      '/api/admin/announcements': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });

    render(<AnnouncementsTab />);

    fireEvent.click(await screen.findByText('Edit'));

    const titleInput = (await screen.findByLabelText('Title (English)')) as HTMLInputElement;
    expect(titleInput.value).toBe('Draft Announcement');

    fireEvent.change(titleInput, { target: { value: 'Edited Title' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/api/admin/announcements/ann-1'));
      expect(patchCall).toBeTruthy();
      expect((patchCall!.body as any).titleEn).toBe('Edited Title');
    });
  });

  it('shows an error state when loading fails', async () => {
    mockFetchByUrl({
      '/api/admin/announcements': { status: 500, body: { error: 'boom' } },
    });

    render(<AnnouncementsTab />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load announcements.')).toBeInTheDocument();
    });
  });
});
