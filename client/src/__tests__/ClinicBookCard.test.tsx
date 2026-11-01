import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClinicBookCard } from '../components/leader/ClinicBookCard';

// The monthly Dominion Clinic book: a leader sends it to their people in one tap.
const calls: { url: string; method: string }[] = [];
function mockFetch(handlers: Record<string, () => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      const body = key ? handlers[key]() : {};
      return Promise.resolve({ ok: Boolean(key), status: key ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('ClinicBookCard', () => {
  it('shows how many of my people have the book and sends it to the rest with one tap', async () => {
    let sent = 4;
    mockFetch({
      '/api/leader/clinic/send': () => {
        sent = 10;
        return { sent: 6, alreadyHad: 4 };
      },
      '/api/leader/clinic': () => ({ book: { id: 'b1', titleEn: 'Kingdom Secrets', titleFr: null }, people: 10, sent, waiting: 10 - sent }),
    });
    render(<ClinicBookCard mode="leader" statusUrl="/api/leader/clinic" sendUrl="/api/leader/clinic/send" />);
    expect(await screen.findByText(/Kingdom Secrets\. 4 of your 10 people already have it\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send it to my 6 people who do not have it' }));
    expect(await screen.findByText('Sent to 6 people, each as a private message.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/leader/clinic/send'))).toBe(true);
    expect(screen.queryByRole('button', { name: /Send it to my/ })).not.toBeInTheDocument();
  });

  it('shows nothing when there is no book open, or a leader has nobody to send to', async () => {
    mockFetch({ '/api/leader/clinic': () => ({ book: null, people: 3, sent: 0, waiting: 0 }) });
    const { container, unmount } = render(<ClinicBookCard mode="leader" statusUrl="/api/leader/clinic" sendUrl="x" />);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(container.querySelector('[data-testid="clinic-book-card"]')).toBeNull();
    unmount();
    mockFetch({ '/api/leader/clinic': () => ({ book: { id: 'b1', titleEn: 'B', titleFr: null }, people: 0, sent: 0, waiting: 0 }) });
    const second = render(<ClinicBookCard mode="leader" statusUrl="/api/leader/clinic" sendUrl="x" />);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(second.container.querySelector('[data-testid="clinic-book-card"]')).toBeNull();
  });

  it('the central admin sends it to everyone who does not have it', async () => {
    mockFetch({
      '/api/admin/cells/clinic/send-all': () => ({ sent: 30, alreadyHad: 20 }),
      '/api/admin/cells/clinic': () => ({ book: { id: 'b1', titleEn: 'Kingdom Secrets', titleFr: null }, members: 50, sent: 20, waiting: 30 }),
    });
    render(<ClinicBookCard mode="central" statusUrl="/api/admin/cells/clinic" sendUrl="/api/admin/cells/clinic/send-all" />);
    expect(await screen.findByText(/20 of 50 members have it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send it now to the 30 who do not have it' }));
    expect(await screen.findByText(/Sent to 30 members/)).toBeInTheDocument();
  });
});
