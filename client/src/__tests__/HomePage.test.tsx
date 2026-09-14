import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';

describe('HomePage', () => {
  beforeEach(() => {
    // The Discover & Grow pathway only appears once an Admin has actually
    // set its content (see HomePage.tsx) — mock a settings response with
    // that content filled in, matching real configured production state,
    // so this test can verify both pathways render together as intended.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          content: {
            discoverTitleEn: 'DISCOVER & GROW',
            discoverCtaEn: 'JOIN OUR SPIRITUAL COMMUNITY',
          },
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the hero and both required pathways, with no referral trace', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    // HomePage shows a brief loading state until the public settings fetch
    // settles (success or failure) — findByText waits for that instead of
    // asserting on the very first, pre-fetch render.
    expect(await screen.findByText('BE EQUIPPED. BE TRANSFORMED. BE SENT.')).toBeInTheDocument();

    // Both pathways, Training first — exact required headings/CTAs.
    expect(screen.getByText('BE EQUIPPED & SENT')).toBeInTheDocument();
    expect(screen.getByText('BEGIN YOUR TRAINING JOURNEY')).toBeInTheDocument();
    expect(screen.getByText('DISCOVER & GROW')).toBeInTheDocument();
    expect(screen.getByText('JOIN OUR SPIRITUAL COMMUNITY')).toBeInTheDocument();

    // Section 15: never gate on identity.
    expect(screen.queryByText(/are you born again/i)).not.toBeInTheDocument();

    // Must not expose internal referral commission mechanics publicly.
    expect(screen.queryByText(/500 FCFA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();

    // Section 8: never reveal who referred the visitor.
    expect(screen.queryByText(/invited by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/referred by/i)).not.toBeInTheDocument();
  });
});
