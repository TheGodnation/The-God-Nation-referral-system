import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AreaRepresentationRequestsTab } from '../components/admin/AreaRepresentationRequestsTab';

const calls: { url: string; method: string; body: unknown }[] = [];

const REQUEST = {
  id: 'req-1',
  note: 'I already lead our cell group here.',
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00Z',
  decidedAt: null,
  decisionNote: null,
  person: { id: 'p1', name: 'Requester One' },
  area: { id: 'area-1', name: 'Bepanda', level: 'QUARTER' },
};

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
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

describe('AreaRepresentationRequestsTab (Admin)', () => {
  it('lists pending requests with person and area', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    expect(await screen.findByText('Requester One')).toBeInTheDocument();
    expect(screen.getByText('Bepanda')).toBeInTheDocument();
    expect(screen.getByText('I already lead our cell group here.')).toBeInTheDocument();
  });

  it('approving calls the approve endpoint and reloads', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/approve': { status: 200, body: { ...REQUEST, status: 'APPROVED', areaLeadershipAssignmentId: 'assign-1' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/area-representation-requests/req-1/approve'))).toBe(true);
    });
  });

  it('declining calls the decline endpoint', async () => {
    mockFetchByUrl({
      '/api/admin/area-representation-requests/req-1/decline': { status: 200, body: { ...REQUEST, status: 'DECLINED' } },
      '/api/admin/area-representation-requests': { status: 200, body: { items: [REQUEST], pagination: { totalPages: 1 } } },
    });
    render(<AreaRepresentationRequestsTab />);
    fireEvent.click(await screen.findByText('Decline'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/area-representation-requests/req-1/decline'))).toBe(true);
    });
  });

  it('shows an empty state when there are no requests', async () => {
    mockFetchByUrl({ '/api/admin/area-representation-requests': { status: 200, body: { items: [], pagination: { totalPages: 1 } } } });
    render(<AreaRepresentationRequestsTab />);
    expect(await screen.findByText('No representation requests found.')).toBeInTheDocument();
  });
});
