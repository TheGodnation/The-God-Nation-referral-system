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
  { email: 'joiner@example.com', kind: 'MEMBER_SIGN_IN', failedTries: 1, lastTriedAt: '2026-10-21T10:00:00Z', name: null, whatsappNumber: null, hasAccount: false, leaderId: null, personId: null },
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
    expect(screen.getByText('App sign-in')).toBeInTheDocument();
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

  it('shows the name first, and the other emails tried from the same phone with their owners\' names', async () => {
    mockFetch({
      items: [
        { email: 'vicky@example.com', kind: 'MEMBER_SIGN_IN', failedTries: 27, lastTriedAt: '2026-11-15T14:16:00Z', name: 'OMAM Victor', whatsappNumber: null, hasAccount: true, leaderId: null, personId: 'p1', sameDevice: [{ email: 'gwess@example.com', name: null, gotIn: false }] },
        { email: 'gwess@example.com', kind: 'MEMBER_SIGN_IN', failedTries: 17, lastTriedAt: '2026-11-15T14:05:00Z', name: null, whatsappNumber: null, hasAccount: false, leaderId: null, personId: null, sameDevice: [{ email: 'vicky@example.com', name: 'OMAM Victor', gotIn: true }] },
      ],
    });
    render(<SignInTroubleTab />);
    // A known person: the name is the heading, the email under it.
    expect(await screen.findByTestId('trouble-name')).toHaveTextContent('OMAM Victor');
    // An unknown email points to the person whose phone it was typed on.
    const boxes = screen.getAllByTestId('same-device');
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toHaveTextContent('Probably the same person');
    expect(boxes[1]).toHaveTextContent('OMAM Victor');
    expect(boxes[1]).toHaveTextContent('vicky@example.com');
    expect(boxes[1]).toHaveTextContent('got in');
    expect(boxes[0]).not.toHaveTextContent('got in');
  });

  it('names the owner of an email that is on a profile or sign-up but cannot sign in', async () => {
    mockFetch({
      items: [
        { email: 'second@example.com', kind: 'MEMBER_SIGN_IN', failedTries: 4, lastTriedAt: '2026-11-15T14:00:00Z', name: 'Profile Owner', nameSource: 'PROFILE', whatsappNumber: null, hasAccount: false, leaderId: null, personId: null },
      ],
    });
    render(<SignInTroubleTab />);
    expect(await screen.findByTestId('trouble-name')).toHaveTextContent('Profile Owner');
    expect(screen.getByTestId('no-account')).toHaveTextContent("This email is on Profile Owner's profile, but it is not a sign-in email");
  });

  it('says when nobody is stuck', async () => {
    mockFetch({ items: [] });
    render(<SignInTroubleTab />);
    expect(await screen.findByText(/Nobody is stuck/)).toBeInTheDocument();
  });
});
