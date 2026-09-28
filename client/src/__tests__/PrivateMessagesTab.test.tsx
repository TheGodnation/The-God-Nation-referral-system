import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrivateMessagesTab } from '../components/admin/PrivateMessagesTab';
import i18n from '../i18n';

// Private Communication / Messaging — Admin management tab. Same
// URL-dispatching fetch mock pattern established across prior admin-tab
// client tests.
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
  i18n.changeLanguage('en');
});

const emptyInbox = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };

describe('PrivateMessagesTab (Admin)', () => {
  it('sends to All Eligible Members by default once a body is entered', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations': { status: 200, body: emptyInbox },
      '/api/admin/private-messages/conversations': { status: 201, body: { targetCount: 42, conversationsCreated: 42, conversationsReused: 0 } },
    });

    render(<PrivateMessagesTab />);
    await waitFor(() => expect(screen.getByText('No private conversations yet.')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello everyone' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      const sendCall = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/private-messages/conversations');
      expect(sendCall).toBeTruthy();
      expect((sendCall!.body as any).scope).toBe('ALL_ELIGIBLE');
    });
    await waitFor(() => expect(screen.getByText('Message sent to 42 recipient(s).')).toBeInTheDocument());
  });

  it('switching to Selected Members requires at least one member before sending is enabled', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations': { status: 200, body: emptyInbox },
      '/api/admin/people?search=': { status: 200, body: { items: [{ id: 'person-1', name: 'Grace Doe' }] } },
    });

    render(<PrivateMessagesTab />);
    await waitFor(() => expect(screen.getByText('No private conversations yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Selected members'));

    const sendButton = screen.getByText('Send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Search people by name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByText('Search'));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'person-1' } });
    fireEvent.click(screen.getByText('Add Member'));

    await waitFor(() => expect(screen.getByText('Grace Doe', { selector: 'span' })).toBeInTheDocument());
  });

  it('switching to Selected Community shows a Community search picker', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations': { status: 200, body: emptyInbox },
      '/api/admin/communities?search=': { status: 200, body: { items: [{ id: 'community-1', name: 'Youth Ministry' }] } },
    });

    render(<PrivateMessagesTab />);
    await waitFor(() => expect(screen.getByText('No private conversations yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Selected Community'));
    fireEvent.change(screen.getByPlaceholderText('Search communities by name'), { target: { value: 'Youth' } });
    fireEvent.click(screen.getByText('Search'));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'community-1' } });
    fireEvent.click(screen.getByText('Select'));

    await waitFor(() => expect(screen.getByText('Youth Ministry', { selector: 'p' })).toBeInTheDocument());
  });

  it('shows an error when sending fails', async () => {
    mockFetchByUrl({
      '/api/private-messages/conversations': { status: 200, body: emptyInbox },
      '/api/admin/private-messages/conversations': { status: 500, body: { error: 'boom' } },
    });

    render(<PrivateMessagesTab />);
    await waitFor(() => expect(screen.getByText('No private conversations yet.')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('renders in French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({ '/api/private-messages/conversations': { status: 200, body: emptyInbox } });

    render(<PrivateMessagesTab />);

    await waitFor(() => {
      expect(screen.getByText('Messages privés')).toBeInTheDocument();
    });
    expect(screen.getByText('Tous les membres éligibles')).toBeInTheDocument();
  });
});
