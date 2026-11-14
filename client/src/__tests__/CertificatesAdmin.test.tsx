import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { CertificatesAdmin } from '../components/admin/CertificatesAdmin';
import i18n from '../i18n';

// The central admin's list of certificate requests: details, private note, and the steps.
const calls: { url: string; method: string; body: any }[] = [];
let items: any[] = [];
// When set, the first "issue" is refused because books remain (the server's NOT_COMPLETE answer).
let refuseIssueOnce = false;

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  personId: `p-${id}`,
  accountName: 'Nji C.',
  whatsappNumber: '+237670000001',
  email: 'nji@example.com',
  nameOnCertificate: 'Nji Clinton',
  language: 'en',
  delivery: 'POST',
  contactPhone: '+237 670 00 00 01',
  address: 'Rue 12, Akwa, Douala',
  status: 'REQUESTED',
  adminNote: null,
  certificateNumber: null,
  issuedAt: null,
  paidAt: null,
  deliveredAt: null,
  requestedAt: '2026-10-20T10:00:00Z',
  ...over,
});

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      let out: any = {};
      if (method === 'POST' && url.endsWith('/issue') && refuseIssueOnce && !(typeof init?.body === 'string' && JSON.parse(init.body).override)) {
        refuseIssueOnce = false;
        return Promise.resolve({ ok: false, status: 409, headers: { get: () => 'application/json' }, json: async () => ({ error: 'This student has passed 5 of 16 books so far.', code: 'NOT_COMPLETE' }) });
      }
      if (method === 'GET') out = { items, open: items.filter((i) => i.status === 'REQUESTED' || i.status === 'PAID').length };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => out });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
  refuseIssueOnce = false;
  i18n.changeLanguage('en');
});

describe('Certificates (admin)', () => {
  it('lists requests with how they want it, where to post it, and how many are waiting', async () => {
    items = [row('c1'), row('c2', { nameOnCertificate: 'Ada Lovelace', delivery: 'EMAIL', address: null, contactPhone: null, status: 'ISSUED', certificateNumber: 'GNLA-2026-001', issuedAt: '2026-10-30T10:00:00Z' })];
    mockFetch();
    render(<CertificatesAdmin />);
    const first = await screen.findByTestId('certificate-row-c1');
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
    expect(within(first).getByText('Nji Clinton')).toBeInTheDocument();
    expect(within(first).getByText('Post to: Rue 12, Akwa, Douala')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/237670000001');
    const second = screen.getByTestId('certificate-row-c2');
    expect(within(second).getByText(/Number: GNLA-2026-001/)).toBeInTheDocument();
    expect(within(second).getByTestId('certificate-download-c2')).toBeInTheDocument();
    expect(within(first).queryByTestId('certificate-download-c1')).toBeNull();
  });

  it('saves a private note and a corrected spelling', async () => {
    items = [row('c1')];
    mockFetch();
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    fireEvent.change(screen.getByTestId('certificate-name-c1'), { target: { value: 'Nji Clinton Jr' } });
    fireEvent.change(screen.getByTestId('certificate-note-c1'), { target: { value: 'Agreed 5 000 FCFA' } });
    fireEvent.click(screen.getByTestId('certificate-save-c1'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/admin/certificates/c1', body: { adminNote: 'Agreed 5 000 FCFA', nameOnCertificate: 'Nji Clinton Jr' } }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('marks paid, and issues only after confirming', async () => {
    items = [row('c1')];
    mockFetch();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    fireEvent.click(screen.getByTestId('certificate-paid-c1'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/certificates/c1/paid' && c.method === 'POST')).toBe(true));
    fireEvent.click(screen.getByTestId('certificate-issue-c1'));
    expect(calls.some((c) => c.url.endsWith('/issue'))).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Nji Clinton'));
    fireEvent.click(screen.getByTestId('certificate-issue-c1'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/certificates/c1/issue' && c.method === 'POST')).toBe(true));
  });

  it('marks an issued certificate as delivered; an issued one cannot be cancelled or have its name changed', async () => {
    items = [row('c1', { status: 'ISSUED', certificateNumber: 'GNLA-2026-001', issuedAt: '2026-10-30T10:00:00Z' })];
    mockFetch();
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    expect(screen.getByTestId('certificate-name-c1')).toBeDisabled();
    expect(screen.queryByTestId('certificate-cancel-c1')).toBeNull();
    expect(screen.queryByTestId('certificate-issue-c1')).toBeNull();
    fireEvent.click(screen.getByTestId('certificate-delivered-c1'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/certificates/c1/delivered')).toBe(true));
  });

  it('can preview the certificate to check the spelling, and message the student', async () => {
    items = [row('c1')];
    mockFetch();
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    fireEvent.click(screen.getByTestId('certificate-preview-c1'));
    expect(screen.getByRole('img', { name: 'Diploma of Nji Clinton' })).toBeInTheDocument();
    expect(screen.getByText(/The number is given when you issue it/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('certificate-message-c1'), { target: { value: 'Hello, the price is 5000.' } });
    fireEvent.click(screen.getByTestId('certificate-send-c1'));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/admin/library/trainees/p-c1/message')).toMatchObject({ method: 'POST', body: { body: 'Hello, the price is 5000.' } }));
    expect(await screen.findByText('Message sent.')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    items = [];
    mockFetch();
    render(<CertificatesAdmin />);
    expect(await screen.findByText('No one has asked for a certificate yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('certificate-filter'), { target: { value: 'ISSUED' } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/certificates?status=ISSUED')).toBe(true));
  });

  it('shows how far each open request is in the 16 books', async () => {
    items = [row('c1', { progress: { eligible: false, passed: 5, total: 16 } }), row('c2', { nameOnCertificate: 'Ada Lovelace', progress: { eligible: true, passed: 16, total: 16 } })];
    mockFetch();
    render(<CertificatesAdmin />);
    expect(await screen.findByTestId('certificate-progress-c1')).toHaveTextContent('Has passed 5 of 16 books so far (asked in advance)');
    expect(screen.getByTestId('certificate-progress-c2')).toHaveTextContent('Has passed all 16 books: ready to issue');
  });

  it('asks a second time before issuing for someone who has not passed every book, and goes ahead only on yes', async () => {
    items = [row('c1', { progress: { eligible: false, passed: 5, total: 16 } })];
    refuseIssueOnce = true;
    mockFetch();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    fireEvent.click(screen.getByTestId('certificate-issue-c1'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/issue')).length).toBe(2));
    expect(confirm).toHaveBeenLastCalledWith('This student has passed 5 of 16 books so far. Issue the certificate anyway?');
    expect(calls.filter((c) => c.url.endsWith('/issue'))[1].body).toEqual({ override: true });
  });

  it('does not issue when the admin says no to the second question', async () => {
    items = [row('c1', { progress: { eligible: false, passed: 5, total: 16 } })];
    refuseIssueOnce = true;
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
    render(<CertificatesAdmin />);
    await screen.findByTestId('certificate-row-c1');
    fireEvent.click(screen.getByTestId('certificate-issue-c1'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/issue')).length).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => c.url.endsWith('/issue')).length).toBe(1);
  });
});
