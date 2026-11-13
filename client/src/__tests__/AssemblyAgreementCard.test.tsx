import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssemblyAgreementCard } from '../components/chat/AssemblyAgreementCard';
import i18n from '../i18n';

// The rules a new member must agree to before they can post or reply in an assembly.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(status = 200, body: unknown = { ok: true }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('Assembly agreement card', () => {
  it('starts as one small bar: the rules are not shown, the group stays in view', () => {
    render(<AssemblyAgreementCard communityId="c1" onAgreed={() => {}} />);
    expect(screen.getByText('Our Assembly Agreement')).toBeInTheDocument();
    expect(screen.getByText(/You can read everything/)).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-rules')).toBeNull();
    expect(screen.queryByTestId('assembly-agree')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // A short bar, never a tall panel.
    expect(screen.getByTestId('assembly-agreement').className).not.toContain('max-h');
  });

  it('opens the rules in a short scrolling panel, can be hidden again, and has only an "I agree" button (no disagree)', () => {
    render(<AssemblyAgreementCard communityId="c1" onAgreed={() => {}} />);
    fireEvent.click(screen.getByTestId('assembly-read'));
    expect(screen.getByTestId('assembly-agreement').className).toContain('max-h-[45vh]');
    expect(screen.getByTestId('assembly-rules').className).toContain('overflow-y-auto');
    expect(screen.getByText('Our Assembly Agreement')).toBeInTheDocument();
    expect(screen.getByText(/Where two or three are gathered/)).toBeInTheDocument();
    for (const rule of ['This is an assembly of God’s people.', 'Know why we are here.', 'No publicity.', 'No insults, no harassment.', 'Leaders look after the assembly.']) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }
    expect(screen.getByText(/personal programs, invitations or advertising/)).toBeInTheDocument();
    expect(screen.queryByText(/private information/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'I agree' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disagree/i })).toBeNull();
    fireEvent.click(screen.getByTestId('assembly-hide'));
    expect(screen.queryByTestId('assembly-rules')).toBeNull();
    expect(screen.getByTestId('assembly-read')).toBeInTheDocument();
  });

  it('records the agreement for this assembly and tells the page', async () => {
    mockFetch();
    const onAgreed = vi.fn();
    render(<AssemblyAgreementCard communityId="c1" onAgreed={onAgreed} />);
    fireEvent.click(screen.getByTestId('assembly-read'));
    fireEvent.click(screen.getByTestId('assembly-agree'));
    await waitFor(() => expect(onAgreed).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.method === 'POST')?.url).toContain('/api/communities/c1/agreement');
  });

  it('shows a message and stays closed if it fails', async () => {
    mockFetch(403, { error: 'You are not a member of this assembly.' });
    const onAgreed = vi.fn();
    render(<AssemblyAgreementCard communityId="c1" onAgreed={onAgreed} />);
    fireEvent.click(screen.getByTestId('assembly-read'));
    fireEvent.click(screen.getByTestId('assembly-agree'));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not a member of this assembly.');
    expect(onAgreed).not.toHaveBeenCalled();
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    render(<AssemblyAgreementCard communityId="c1" onAgreed={() => {}} />);
    expect(screen.getByText('Notre engagement d’assemblée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lire les règles' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assembly-read'));
    expect(screen.getByText('Pas de publicité.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'J’accepte' })).toBeInTheDocument();
  });
});
