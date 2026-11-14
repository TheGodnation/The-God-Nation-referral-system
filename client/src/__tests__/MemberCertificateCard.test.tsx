import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemberCertificateCard, CertificateInfo } from '../components/certificate/MemberCertificateCard';
import i18n from '../i18n';

// The student's side of the diploma: an example, asking for it once every book is passed, and where it stands.
// Which design is asked for when the picture is drawn (the images themselves do not load in the test browser).
const templates: string[] = [];
vi.mock('../lib/certificateRender', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/certificateRender')>();
  return { ...actual, loadTemplate: vi.fn((lang: string) => { templates.push(lang); return new Promise<HTMLImageElement>(() => {}); }) };
});

const calls: { url: string; method: string; body: any }[] = [];
let response: { status: number; body: unknown } = { status: 201, body: {} };

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return Promise.resolve({ ok: response.status < 300, status: response.status, headers: { get: () => 'application/json' }, json: async () => response.body });
    }),
  );
}

afterEach(async () => {
  cleanup(); // unmount first, so switching the language back does not redraw a leftover card
  vi.unstubAllGlobals();
  calls.length = 0;
  templates.length = 0;
  response = { status: 201, body: {} };
  sessionStorage.clear();
  await i18n.changeLanguage('en');
});

const info = (over: Partial<CertificateInfo> = {}): CertificateInfo => ({ eligible: false, passed: 3, total: 16, defaultName: 'Nji Clinton', defaultLanguage: 'en', request: null, ...over });
const request = (over: Record<string, unknown> = {}) => ({
  status: 'REQUESTED',
  nameOnCertificate: 'Nji Clinton',
  language: 'en',
  delivery: 'EMAIL',
  contactPhone: null,
  address: null,
  requestedAt: '2026-10-20T10:00:00Z',
  certificateNumber: null,
  issuedAt: null,
  deliveredAt: null,
  ...over,
});

describe('Certificate card (student)', () => {
  it('before every book is passed: says all 16 are needed, lets them ask in advance, and shows an example with a made-up name', () => {
    render(<MemberCertificateCard info={info()} onChanged={() => {}} />);
    expect(screen.getByTestId('certificate-intro')).toHaveTextContent('you must study and pass all 16 books (3 passed so far)');
    expect(screen.getByTestId('certificate-ask')).toBeInTheDocument();
    expect(screen.queryByTestId('certificate-sample')).toBeNull();
    fireEvent.click(screen.getByTestId('certificate-sample-toggle'));
    expect(screen.getByTestId('certificate-sample')).toHaveTextContent('This is an example with a made-up name.');
    expect(screen.getByRole('img', { name: 'Example of the diploma, with a made-up name' })).toBeInTheDocument();
  });

  it('shows the example in the language the app is read in: French for a French reader, with a switch to English', async () => {
    await i18n.changeLanguage('fr');
    render(<MemberCertificateCard info={info({ defaultLanguage: 'en' })} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('certificate-sample-toggle'));
    await waitFor(() => expect(templates).toContain('fr'));
    expect(templates).not.toContain('en');
    expect(screen.getByTestId('certificate-sample-fr')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('certificate-sample-en'));
    await waitFor(() => expect(templates).toContain('en'));
  });

  it('shows the English example to an English reader', async () => {
    render(<MemberCertificateCard info={info({ defaultLanguage: 'fr' })} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('certificate-sample-toggle'));
    await waitFor(() => expect(templates).toContain('en'));
    expect(templates).not.toContain('fr');
  });

  it('lets someone who has not finished fill in the request in advance, reminding them of all 16 books', async () => {
    mockFetch();
    const onChanged = vi.fn();
    render(<MemberCertificateCard info={info({ passed: 0 })} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('certificate-ask'));
    expect(screen.getByTestId('certificate-form-notice')).toHaveTextContent('pass all 16 books (0 passed so far)');
    fireEvent.click(screen.getByTestId('certificate-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/member/certificate', body: { name: 'Nji Clinton', delivery: 'EMAIL', language: 'en' } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('starts the certificate language as the language of the app', async () => {
    await i18n.changeLanguage('fr');
    mockFetch();
    render(<MemberCertificateCard info={info({ eligible: true, defaultLanguage: 'en' })} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('certificate-ask'));
    fireEvent.click(screen.getByTestId('certificate-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body.language).toBe('fr'));
  });

  it('after asking in advance: says it is saved and will be issued once all 16 books are passed', () => {
    render(<MemberCertificateCard info={info({ request: request() as any })} onChanged={() => {}} />);
    expect(screen.getByText('Your request is saved. Your certificate will be issued once you have passed all 16 books (3 passed so far).')).toBeInTheDocument();
  });

  it('never shows a price anywhere', () => {
    render(<MemberCertificateCard info={info({ eligible: true })} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('certificate-ask'));
    expect(document.body.textContent).not.toMatch(/FCFA|price|prix/i);
  });

  it('once every book is passed: asks for the name as printed and how to receive it, and sends the request', async () => {
    mockFetch();
    const onChanged = vi.fn();
    render(<MemberCertificateCard info={info({ eligible: true, passed: 16 })} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('certificate-ask'));
    expect(screen.getByTestId('certificate-name')).toHaveValue('Nji Clinton');
    fireEvent.change(screen.getByTestId('certificate-name'), { target: { value: 'Nji Clinton Jr' } });
    // Posting needs an address and a phone; by email needs neither.
    expect(screen.queryByTestId('certificate-address')).toBeNull();
    expect(screen.queryByTestId('certificate-phone')).toBeNull();
    fireEvent.click(screen.getByTestId('certificate-delivery-POST'));
    fireEvent.change(screen.getByTestId('certificate-address'), { target: { value: 'Rue 12, Akwa, Douala' } });
    fireEvent.change(screen.getByTestId('certificate-phone'), { target: { value: '+237 670 00 00 01' } });
    fireEvent.click(screen.getByTestId('certificate-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/member/certificate',
      body: { name: 'Nji Clinton Jr', language: 'en', delivery: 'POST', address: 'Rue 12, Akwa, Douala', phone: '+237 670 00 00 01' },
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows the server\'s reason when the request is refused', async () => {
    response = { status: 400, body: { error: 'Write the address where it should be posted.', code: 'ADDRESS' } };
    mockFetch();
    render(<MemberCertificateCard info={info({ eligible: true })} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('certificate-ask'));
    fireEvent.click(screen.getByTestId('certificate-delivery-POST'));
    fireEvent.click(screen.getByTestId('certificate-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write the address where it should be posted.');
  });

  it('in the Play Store version, sends them to the website instead of taking the request', () => {
    sessionStorage.setItem('godnation:store-app', '1');
    render(<MemberCertificateCard info={info()} onChanged={() => {}} />);
    expect(screen.getByText(/all 16 books/)).toBeInTheDocument();
    expect(screen.getByText(/open thegodnationacademy.org/)).toBeInTheDocument();
    expect(screen.queryByTestId('certificate-ask')).toBeNull();
  });

  it('after asking: says it was received, and lets them change it while it is only a request', () => {
    render(<MemberCertificateCard info={info({ eligible: true, passed: 16, request: request() as any })} onChanged={() => {}} />);
    expect(screen.getByText('Your request was received. The Academy will contact you.')).toBeInTheDocument();
    expect(screen.getByText(/It will be sent to you by email or WhatsApp/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('certificate-change'));
    expect(screen.getByTestId('certificate-form')).toBeInTheDocument();
    expect(screen.getByTestId('certificate-name')).toHaveValue('Nji Clinton');
  });

  it('when paid: says it is being prepared, with no way to change it any more', () => {
    render(<MemberCertificateCard info={info({ eligible: true, request: request({ status: 'PAID' }) as any })} onChanged={() => {}} />);
    expect(screen.getByText('Everything is arranged. Your certificate is being prepared.')).toBeInTheDocument();
    expect(screen.queryByTestId('certificate-change')).toBeNull();
  });

  it('when issued: shows the certificate and its number; saving it is offered only if it is sent by email or WhatsApp', () => {
    const issued = { status: 'ISSUED', certificateNumber: 'GNLA-2026-001', issuedAt: '2026-10-30T10:00:00Z' };
    const { rerender } = render(<MemberCertificateCard info={info({ eligible: true, request: request(issued) as any })} onChanged={() => {}} />);
    expect(screen.getByText('Your certificate has been issued.')).toBeInTheDocument();
    expect(screen.getByText('GNLA-2026-001')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Diploma of Nji Clinton' })).toBeInTheDocument();
    expect(screen.getByTestId('certificate-download')).toBeInTheDocument();
    expect(screen.queryByTestId('certificate-change')).toBeNull();

    rerender(<MemberCertificateCard info={info({ eligible: true, request: request({ ...issued, delivery: 'POST', address: 'Rue 12, Akwa' }) as any })} onChanged={() => {}} />);
    expect(screen.getByText('It will be posted to: Rue 12, Akwa')).toBeInTheDocument();
    expect(screen.queryByTestId('certificate-download')).toBeNull();
  });

  it('speaks French', () => {
    i18n.changeLanguage('fr');
    render(<MemberCertificateCard info={info({ defaultLanguage: 'fr' })} onChanged={() => {}} />);
    expect(screen.getByText(/vous devez étudier et réussir les 16 livres \(3 réussis jusqu’ici\)/)).toBeInTheDocument();
    expect(screen.getByText('Voir un exemple')).toBeInTheDocument();
  });
});
