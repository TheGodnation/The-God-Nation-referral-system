import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberReferralsPage } from '../pages/MemberReferralsPage';

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
    <MemoryRouter initialEntries={['/member/referrals']}>
      <Routes>
        <Route path="/member/referrals" element={<MemberReferralsPage />} />
        <Route path="/member/me" element={<div>Me page</div>} />
        <Route path="/member/people/:personId" element={<div>Profile page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemberReferralsPage', () => {
  it('shows the referral link and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockFetch({
      '/api/member/referrals/links': { links: { en: 'https://example.com/join?ref=ABC123&lang=en', fr: 'https://example.com/join?ref=ABC123&lang=fr' } },
      '/api/member/referrals/mine': { items: [] },
    });
    renderPage();

    expect(await screen.findByText('https://example.com/join?ref=ABC123&lang=en')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/join?ref=ABC123&lang=en'));
    expect(await screen.findByText('Link copied!')).toBeInTheDocument();
  });

  it('lists people referred, linking to their profile', async () => {
    mockFetch({
      '/api/member/referrals/links': { links: { en: 'https://example.com/join?ref=XYZ&lang=en', fr: 'https://example.com/join?ref=XYZ&lang=fr' } },
      '/api/member/referrals/mine': { items: [{ personId: 'p1', name: 'Grace Mbeki', photoUrl: null, joinedAt: '2026-10-11T00:00:00Z' }] },
    });
    renderPage();

    expect(await screen.findByText('Grace Mbeki')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Grace Mbeki'));
    await waitFor(() => expect(screen.getByText('Profile page')).toBeInTheDocument());
  });

  it('shows an empty state when nobody has joined yet', async () => {
    mockFetch({
      '/api/member/referrals/links': { links: { en: 'https://example.com/join?ref=NONE&lang=en', fr: 'https://example.com/join?ref=NONE&lang=fr' } },
      '/api/member/referrals/mine': { items: [] },
    });
    renderPage();

    expect(await screen.findByText("Nobody has joined through your link yet.")).toBeInTheDocument();
  });
});
