import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyFollowUp } from '../components/leader/MyFollowUp';

// Phase 3J — Workflow A: Needs Attention → Log Contact. Same URL-dispatching
// fetch mock pattern as MyFollowUpAttention.test.tsx / CommunityGeography
// Reparenting.test.tsx, extended to record every call so tests can assert
// exactly what the contact POST sent.
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const match = Object.keys(responses).find((key) => url.includes(key));
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

const ONE_ROLE = { items: [{ id: 'r1', community: { id: 'c1', name: 'My Community' }, geography: null }] };
const NO_FOLLOWUPS = { items: [] };
const ONE_ATTENTION_ITEM = {
  items: [
    {
      followUpAssignmentId: 'assignment-1',
      personId: 'p1',
      name: 'Jane Doe',
      reason: 'EMERGENCY',
      lastContactedAt: '2026-09-01T00:00:00Z',
      nextFollowUpDate: null,
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('MyFollowUp — Phase 3J Needs Attention → Log Contact', () => {
  it('renders a Log Contact action for a Needs Attention item', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 200, body: ONE_ATTENTION_ITEM },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Log Contact')).toBeInTheDocument();
  });

  it('submits the contact using the attention item\'s own followUpAssignmentId, wellbeingStatus, note, and nextFollowUpDate', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 200, body: ONE_ATTENTION_ITEM },
      '/api/leader/follow-ups/assignment-1/contacts': { status: 201, body: { id: 'contact-1' } },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('Log Contact'));

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const wellbeingSelect = selects[selects.length - 1];
    fireEvent.change(wellbeingSelect, { target: { value: 'UNABLE_TO_REACH' } });

    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[textareas.length - 1], { target: { value: 'Tried calling twice.' } });

    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[dateInputs.length - 1], { target: { value: '2026-10-01' } });

    fireEvent.click(screen.getByText('Log Contact', { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      const postCall = calls.find((c) => c.url === '/api/leader/follow-ups/assignment-1/contacts' && c.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall!.body).toMatchObject({
        wellbeingStatus: 'UNABLE_TO_REACH',
        note: 'Tried calling twice.',
      });
      expect(new Date((postCall!.body as any).nextFollowUpDate).toISOString().slice(0, 10)).toBe('2026-10-01');
    });
  });

  it('refreshes the follow-ups and attention lists after a successful submission', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 200, body: ONE_ATTENTION_ITEM },
      '/api/leader/follow-ups/assignment-1/contacts': { status: 201, body: { id: 'contact-1' } },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('Log Contact'));
    fireEvent.click(screen.getByText('Log Contact', { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      expect(screen.getByText('Contact logged.')).toBeInTheDocument();
    });

    const attentionCalls = calls.filter((c) => c.url === '/api/leader/follow-ups/attention' && c.method === 'GET');
    const followUpCalls = calls.filter((c) => c.url === '/api/leader/follow-ups' && c.method === 'GET');
    expect(attentionCalls.length).toBeGreaterThanOrEqual(2);
    expect(followUpCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('surfaces an API error instead of swallowing it', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 200, body: ONE_ATTENTION_ITEM },
      '/api/leader/follow-ups/assignment-1/contacts': { status: 409, body: { error: 'This follow-up assignment is closed.' } },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    fireEvent.click(await screen.findByText('Log Contact'));
    fireEvent.click(screen.getByText('Log Contact', { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      expect(screen.getByText('This follow-up assignment is closed.')).toBeInTheDocument();
    });
  });

  it('leaves existing Needs Attention rendering intact', async () => {
    mockFetchByUrl({
      '/api/leader/role-assignments': { status: 200, body: ONE_ROLE },
      '/api/leader/follow-ups/attention': { status: 200, body: ONE_ATTENTION_ITEM },
      '/api/leader/follow-ups': { status: 200, body: NO_FOLLOWUPS },
    });

    render(<MyFollowUp />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Emergency')).toBeInTheDocument();
  });
});
