import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignInTroubleTab } from '../components/admin/SignInTroubleTab';

// Admin → Sign-in trouble: the list of people still stuck, with their emails.
const urls: string[] = [];

function mockFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  urls.length = 0;
});

const ITEMS = [
  { email: 'paul@gmial.com', kind: 'LEADER_SIGN_IN', failedTries: 3, lastTriedAt: '2026-10-22T10:00:00Z', name: 'Pastor Paul', whatsappNumber: null, hasAccount: true, leaderId: 'u1', personId: null },
  { email: 'joiner@example.com', kind: 'UNFINISHED_SIGNUP', failedTries: 0, lastTriedAt: '2026-10-21T10:00:00Z', name: null, whatsappNumber: null, hasAccount: false, leaderId: null, personId: null },
];

describe('Sign-in trouble', () => {
  it('lists who is stuck, flags misspelled emails, and copies all emails', async () => {
    mockFetch({ items: ITEMS });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SignInTroubleTab />);

    expect(await screen.findByText('paul@gmial.com')).toBeInTheDocument();
    expect(screen.getByText('2 people')).toBeInTheDocument();
    expect(screen.getByText('Leader page sign-in')).toBeInTheDocument();
    expect(screen.getByText('Joining not finished')).toBeInTheDocument();
    expect(screen.getByText(/did they mean paul@gmail\.com/)).toBeInTheDocument();
    expect(screen.getByText(/3 wrong tries/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy all emails' }));
    expect(writeText).toHaveBeenCalledWith('paul@gmial.com\njoiner@example.com');

    // Only the leader has an account to help with.
    expect(screen.getAllByRole('button', { name: 'Help them sign in' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Help them sign in' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Help Pastor Paul sign in');

    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(await screen.findByText('paul@gmial.com')).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/api/admin/sign-in-trouble?days=90'))).toBe(true);
  });

  it('says when nobody is stuck', async () => {
    mockFetch({ items: [] });
    render(<SignInTroubleTab />);
    expect(await screen.findByText(/Nobody is stuck/)).toBeInTheDocument();
  });
});
