import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLeadershipPage } from '../pages/MemberLeadershipPage';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/member/leadership']}>
      <Routes>
        <Route path="/member/leadership" element={<MemberLeadershipPage />} />
        <Route path="/member/people" element={<div>People page</div>} />
        <Route path="/member/people/:personId" element={<div>Profile page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemberLeadershipPage', () => {
  it('shows the directory and lets a member with no pending request submit one', async () => {
    let mine: unknown[] = [];
    mockFetch({
      'GET /api/member/representation-requests/mine': () => ({ body: { items: mine } }),
      'GET /api/member/leadership-directory': () => ({
        body: { items: [{ personId: 'p1', name: 'Grace Mbeki', photoUrl: null, label: 'Yaoundé III Youth' }] },
      }),
      'POST /api/member/representation-requests': () => {
        const created = { id: 'r1', label: 'Douala Central', note: null, status: 'PENDING', decisionNote: null, createdAt: '2026-10-11T00:00:00Z' };
        mine = [created];
        return { status: 201, body: created };
      },
    });
    renderPage();

    expect(await screen.findByText('Grace Mbeki')).toBeInTheDocument();
    expect(screen.getByText('Yaoundé III Youth')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Yaoundé III Youth'), { target: { value: 'Douala Central' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(screen.getByText('Pending review')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/member/representation-requests')?.body).toEqual({ label: 'Douala Central' });
  });

  it('shows a pending request with a withdraw option instead of the form', async () => {
    let mine: unknown[] = [{ id: 'r2', label: 'Bamenda Ridge', note: null, status: 'PENDING', decisionNote: null, createdAt: '2026-10-10T00:00:00Z' }];
    mockFetch({
      'GET /api/member/representation-requests/mine': () => ({ body: { items: mine } }),
      'GET /api/member/leadership-directory': () => ({ body: { items: [] } }),
      'DELETE /api/member/representation-requests/r2': () => {
        mine = [];
        return { body: { ok: true } };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    expect(await screen.findByText('Bamenda Ridge')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g. Yaoundé III Youth')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Yaoundé III Youth')).toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/member/representation-requests/r2')).toBe(true);
  });

  it('shows a declined request with its decision note in history', async () => {
    mockFetch({
      'GET /api/member/representation-requests/mine': () => ({
        body: {
          items: [
            { id: 'r3', label: 'Garoua East', note: null, status: 'DECLINED', decisionNote: 'Not enough information yet.', createdAt: '2026-10-09T00:00:00Z' },
          ],
        },
      }),
      'GET /api/member/leadership-directory': () => ({ body: { items: [] } }),
    });
    renderPage();

    expect(await screen.findByText('Garoua East')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText('Note from the leadership: Not enough information yet.')).toBeInTheDocument();
  });

  it('shows an already-pending error when submitting while one is pending server-side', async () => {
    mockFetch({
      'GET /api/member/representation-requests/mine': () => ({ body: { items: [] } }),
      'GET /api/member/leadership-directory': () => ({ body: { items: [] } }),
      'POST /api/member/representation-requests': () => ({ status: 409, body: { error: 'You already have a pending request.' } }),
    });
    renderPage();

    await screen.findByText('Approved representatives');
    fireEvent.change(screen.getByPlaceholderText('e.g. Yaoundé III Youth'), { target: { value: 'Something' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('Already pending — please wait for a decision.')).toBeInTheDocument();
  });
});
