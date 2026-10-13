import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GeographicAreasTab } from '../components/admin/GeographicAreasTab';

const calls: { url: string; method: string; body: unknown }[] = [];

const COUNTRY = { id: 'area-country', parentId: null, name: 'Cameroon', level: 'NATIONAL', country: 'Cameroon', _count: { children: 1 }, leadershipAssignments: [] };
const REGION = {
  id: 'area-region',
  parentId: 'area-country',
  name: 'Littoral',
  level: 'REGION',
  country: 'Cameroon',
  _count: { children: 0 },
  leadershipAssignments: [{ id: 'assign-1', person: { id: 'p1', name: 'Grace Leader' } }],
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

describe('GeographicAreasTab (Admin)', () => {
  it('lists NATIONAL roots, and drilling into one shows its children', async () => {
    mockFetchByUrl({
      '/api/admin/geographic-areas?parentId=area-country': { status: 200, body: { items: [REGION] } },
      '/api/admin/geographic-areas?': { status: 200, body: { items: [COUNTRY] } },
    });
    render(<GeographicAreasTab />);
    expect(await screen.findByText('Cameroon')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cameroon'));
    expect(await screen.findByText('Littoral')).toBeInTheDocument();
    expect(screen.getByText('Grace Leader')).toBeInTheDocument();
  });

  it('creates a new country via the form', async () => {
    mockFetchByUrl({
      '/api/admin/geographic-areas?': { status: 200, body: { items: [] } },
      'POST /api/admin/geographic-areas': { status: 201, body: { ...COUNTRY, id: 'area-new' } },
    });
    render(<GeographicAreasTab />);
    fireEvent.click(await screen.findByText('+ New Country'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Littoral'), { target: { value: 'Nigeria' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const createCall = calls.find((c) => c.method === 'POST');
      expect(createCall).toBeTruthy();
      expect((createCall!.body as any)).toEqual({ parentId: null, name: 'Nigeria' });
    });
  });

  it('shows "Vacant" for an area with no leadership assignment, and offers Assign leader', async () => {
    const vacant = { ...REGION, id: 'area-vacant', name: 'Far North', leadershipAssignments: [] };
    mockFetchByUrl({ '/api/admin/geographic-areas?': { status: 200, body: { items: [vacant] } } });
    render(<GeographicAreasTab />);
    expect(await screen.findByText('Vacant — no leader assigned')).toBeInTheDocument();
    expect(screen.getByText('Assign leader')).toBeInTheDocument();
  });

  it('ending a leadership assignment calls the end endpoint', async () => {
    mockFetchByUrl({
      '/api/admin/geographic-areas?': { status: 200, body: { items: [REGION] } },
      'PATCH /api/admin/area-leadership-assignments/assign-1/end': { status: 200, body: { id: 'assign-1', status: 'ENDED' } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GeographicAreasTab />);
    fireEvent.click(await screen.findByText('End'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/area-leadership-assignments/assign-1/end'))).toBe(true);
    });
  });
});
