import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from '../pages/WelcomePage';

describe('WelcomePage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: {} }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the outreach welcome message with a CTA into the Training registration flow', async () => {
    render(
      <MemoryRouter initialEntries={['/welcome?ref=MARY7X2&lang=en']}>
        <WelcomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('You Are Loved, and You Are Not Alone')).toBeInTheDocument();

    const cta = screen.getByText('JOIN OUR COMMUNITY').closest('a');
    expect(cta).toHaveAttribute('href', '/register?pathway=TRAINING');

    // Section 8: never reveal who referred the visitor, even though this
    // page was reached via a Leader's own referral code.
    expect(screen.queryByText(/MARY7X2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/invited by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/referred by/i)).not.toBeInTheDocument();
  });
});
