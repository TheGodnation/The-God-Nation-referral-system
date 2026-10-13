import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberPrayerPage } from '../pages/MemberPrayerPage';

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const body = key ? routes[key] : { error: 'not found' };
      return Promise.resolve({
        ok: Boolean(key),
        status: key ? 200 : 404,
        headers: { get: () => 'application/json' },
        json: async () => body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/member/prayer']}>
      <Routes>
        <Route path="/member/prayer" element={<MemberPrayerPage />} />
        <Route path="/member/updates" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemberPrayerPage', () => {
  it('renders the shared PrayerRequests feed and a back link to Home', async () => {
    mockFetch({ '/api/prayer-requests': { viewer: { canPost: true, personId: 'me' }, items: [], nextBefore: null } });
    renderPage();

    expect(await screen.findByText('No prayer requests yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back to Home'));
    await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
  });
});
