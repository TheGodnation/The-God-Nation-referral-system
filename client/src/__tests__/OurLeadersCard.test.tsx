import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OurLeadersCard } from '../components/member/OurLeadersCard';

// The "Our Leaders" card on the People page always has a clear button to ask to
// represent your area — even when nobody has been appointed yet.
function mockFaces(items: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items }) })),
  );
}
afterEach(() => vi.unstubAllGlobals());

const renderCard = () =>
  render(
    <MemoryRouter>
      <OurLeadersCard />
    </MemoryRouter>,
  );

describe('Our Leaders card', () => {
  it('has a "Request to represent your area" button even when there are no leaders yet', async () => {
    mockFaces([]);
    renderCard();
    expect(screen.getByRole('link', { name: /Request to represent your area/ })).toHaveAttribute('href', '/member/leadership#represent');
    expect(await screen.findByText('Leaders will appear here as they are appointed.')).toBeInTheDocument();
  });

  it('shows faces of the leaders appointed, with the same button', async () => {
    mockFaces([{ personId: 'p1', name: 'Grace Leader', photoUrl: null }]);
    renderCard();
    expect(await screen.findByRole('img', { name: 'Grace Leader', hidden: true })).toBeInTheDocument();
    expect(screen.getByText(/See who represents The God Nation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request to represent your area/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Our Leaders/ })).toHaveAttribute('href', '/member/leadership');
  });
});
