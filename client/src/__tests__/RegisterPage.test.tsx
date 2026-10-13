import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from '../pages/RegisterPage';

// Screen 1 of the public join flow: only email + password are asked for —
// the pathway was already chosen via the ?pathway= query param (the
// homepage/welcome page's CTA), and nothing (phone, name, location) is
// collected until screen 3 (finish). See memberAuth.ts's
// /signup/{start,check-code,finish}.
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: {}, supportWhatsappUrl: null }),
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('RegisterPage', () => {
  it('shows only email + password on screen 1, never asking for a phone number upfront', () => {
    mockFetch();
    render(
      <MemoryRouter initialEntries={['/register?pathway=TRAINING']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone Number')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('shows the Discover & Grow title for that pathway', () => {
    mockFetch();
    render(
      <MemoryRouter initialEntries={['/register?pathway=DISCOVER_GROW']}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Join Our Spiritual Community')).toBeInTheDocument();
  });
});
