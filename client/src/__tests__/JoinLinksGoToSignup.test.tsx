import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { JoinPage } from '../pages/JoinPage';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body });
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/welcome" element={<JoinPage />} />
        <Route path="/register" element={<Navigate to="/member/join" replace />} />
        <Route path="/member/join" element={<div>SIGN-UP PAGE</div>} />
        <Route path="/" element={<div>HOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Leaders’ shared links lead to sign-up', () => {
  it('/join?ref=… records the visit, then opens the sign-up page', async () => {
    mockFetch();
    renderAt('/join?ref=MARY123&lang=en');
    expect(await screen.findByText('SIGN-UP PAGE')).toBeInTheDocument();
    const visit = calls.find((c) => c.url.includes('/api/referrals/visit'));
    expect(visit?.body.ref).toBe('MARY123');
  });

  it('an older /welcome?ref=… link still records the visit and opens the sign-up page', async () => {
    mockFetch();
    renderAt('/welcome?ref=MARY123&lang=fr');
    expect(await screen.findByText('SIGN-UP PAGE')).toBeInTheDocument();
    const visit = calls.find((c) => c.url.includes('/api/referrals/visit'));
    expect(visit?.body.ref).toBe('MARY123');
    expect(visit?.body.lang).toBe('fr');
  });

  it('an older /register link opens the sign-up page', async () => {
    mockFetch();
    renderAt('/register?pathway=TRAINING');
    await waitFor(() => expect(screen.getByText('SIGN-UP PAGE')).toBeInTheDocument());
  });
});
