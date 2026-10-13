import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StartPrivateMessage } from '../components/leader/StartPrivateMessage';

// Private Communication / Messaging — Leader compose/start-message action,
// restricted to members of exact Communities the Leader leads. Same
// URL-dispatching fetch mock pattern established across prior client tests.
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

describe('StartPrivateMessage (Leader compose action)', () => {
  it('shows a message when the Leader leads no Community', async () => {
    mockFetchByUrl({ '/api/leader/role-assignments': { status: 200, body: { items: [] } } });

    render(<StartPrivateMessage />);

    await waitFor(() => {
      expect(screen.getByText('You do not currently lead any Community.')).toBeInTheDocument();
    });
  });

  it('lists only the Leader\'s own exact-led Communities in the picker', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'community-1', name: 'Youth Ministry' } }] },
      },
    });

    render(<StartPrivateMessage />);

    await waitFor(() => {
      expect(screen.getByText('Youth Ministry')).toBeInTheDocument();
    });
  });

  it('selecting a Community and a member reveals the composer, restricted to that Community\'s scoped-people search', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'community-1', name: 'Youth Ministry' } }] },
      },
      '/api/leader/scoped-people': { status: 200, body: { items: [{ id: 'person-1', name: 'Grace Doe' }] } },
    });

    render(<StartPrivateMessage />);
    await waitFor(() => expect(screen.getByText('Youth Ministry')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'community-1' } });
    fireEvent.change(screen.getByPlaceholderText('Search members by name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByText('Search'));

    // Two comboboxes now exist (Community picker + SearchPicker results) —
    // wait for the second (results) combobox to actually appear before
    // selecting from it.
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[comboboxes.length - 1], { target: { value: 'person-1' } });
    fireEvent.click(screen.getByText('Select'));

    await waitFor(() => {
      expect(screen.getByText('Grace Doe')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends the message to the selected recipient via /api/leader/private-messages/conversations', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': {
        status: 200,
        body: { items: [{ id: 'r1', community: { id: 'community-1', name: 'Youth Ministry' } }] },
      },
      '/api/leader/scoped-people': { status: 200, body: { items: [{ id: 'person-1', name: 'Grace Doe' }] } },
      '/api/leader/private-messages/conversations': { status: 201, body: { targetCount: 1, conversationsCreated: 1, conversationsReused: 0 } },
    });

    render(<StartPrivateMessage />);
    await waitFor(() => expect(screen.getByText('Youth Ministry')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'community-1' } });
    fireEvent.change(screen.getByPlaceholderText('Search members by name'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[comboboxes.length - 1], { target: { value: 'person-1' } });
    fireEvent.click(screen.getByText('Select'));
    await waitFor(() => expect(screen.getByText('Grace Doe')).toBeInTheDocument());

    // The selected-recipient composer's textarea is the first on the page —
    // the second is the unrelated "message all my members" composer below it.
    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Hello Grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const sendCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/leader/private-messages/conversations'));
      expect(sendCall).toBeTruthy();
      expect((sendCall!.body as any).personIds).toEqual(['person-1']);
      expect((sendCall!.body as any).body).toBe('Hello Grace');
    });
    await waitFor(() => expect(screen.getByText('Message sent.')).toBeInTheDocument());
  });
});
