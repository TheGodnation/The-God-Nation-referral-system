import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberChatsPage } from '../pages/MemberChatsPage';
import { AssistanceButton } from '../components/member/AssistanceButton';
import { SettingsTab } from '../pages/AdminDashboardPage';
import { normalizeWhatsappLink, withPrefilledMessage } from '../lib/whatsapp';

// The green WhatsApp "Assistance" button in the corner of the Chats page, and
// the admin field that sets it.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any) => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      return Promise.resolve({ ok: Boolean(key), status: key ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (key ? routes[key](body) : {}) });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('the helpers', () => {
  it('turns a typed number into a wa.me link, completes a link, and keeps anything else', () => {
    expect(normalizeWhatsappLink('+237 670 00 00 00')).toBe('https://wa.me/237670000000');
    expect(normalizeWhatsappLink('(237) 670-000-000')).toBe('https://wa.me/237670000000');
    expect(normalizeWhatsappLink('wa.me/237670000000')).toBe('https://wa.me/237670000000');
    expect(normalizeWhatsappLink('chat.whatsapp.com/ABC')).toBe('https://chat.whatsapp.com/ABC');
    expect(normalizeWhatsappLink('https://wa.me/237670000000')).toBe('https://wa.me/237670000000');
    // A local Cameroon number (9 digits) gets the +237 in front; an international 00 prefix is understood.
    expect(normalizeWhatsappLink('677272261')).toBe('https://wa.me/237677272261');
    expect(normalizeWhatsappLink('677 27 22 61')).toBe('https://wa.me/237677272261');
    expect(normalizeWhatsappLink('00237677272261')).toBe('https://wa.me/237677272261');
    expect(normalizeWhatsappLink('+33 6 12 34 56 78')).toBe('https://wa.me/33612345678');
    expect(normalizeWhatsappLink('   ')).toBeNull();
    expect(normalizeWhatsappLink(null)).toBeNull();
  });
  it('adds the first message to a chat link, but never to a group invite', () => {
    expect(withPrefilledMessage('https://wa.me/237670000000', 'Hello there')).toBe('https://wa.me/237670000000?text=Hello+there');
    expect(withPrefilledMessage('https://chat.whatsapp.com/ABC', 'Hello')).toBe('https://chat.whatsapp.com/ABC');
    expect(withPrefilledMessage('https://wa.me/237670000000?text=Hi', 'Hello')).toBe('https://wa.me/237670000000?text=Hi');
    expect(withPrefilledMessage('not a url', 'Hello')).toBe('not a url');
  });
});

describe('AssistanceButton', () => {
  it('shows nothing until a number has been set', async () => {
    mockFetch({ 'GET /api/settings/public': () => ({ content: {}, supportWhatsappUrl: null }) });
    render(<AssistanceButton />);
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/settings/public'))).toBe(true));
    expect(screen.queryByTestId('assistance-button')).toBeNull();
  });

  it('is a small green WhatsApp button that opens a chat with a first message typed, without covering the page', async () => {
    mockFetch({ 'GET /api/settings/public': () => ({ content: {}, supportWhatsappUrl: 'https://wa.me/237670000000' }) });
    const { container } = render(<AssistanceButton />);
    const link = await screen.findByTestId('assistance-button');
    expect(link).toHaveAttribute('href', 'https://wa.me/237670000000?text=Hello%2C+I+need+assistance+with+The+God+Nation+app.');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAccessibleName('Chat with us on WhatsApp for assistance');
    expect(link.className).toMatch(/h-12 w-12/);
    // The row it sits in lets taps through everywhere except the button itself.
    expect((container.firstChild as HTMLElement).className).toMatch(/pointer-events-none/);
    expect(link.className).toMatch(/pointer-events-auto/);
  });

  it('is on the Chats page', async () => {
    mockFetch({
      'GET /api/settings/public': () => ({ content: {}, supportWhatsappUrl: 'https://wa.me/237670000000' }),
      'GET /api/member/me/community-memberships': () => ({ items: [] }),
    });
    render(
      <MemoryRouter>
        <MemberChatsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('assistance-button')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
  });
});

describe('Admin → Settings: the assistance WhatsApp', () => {
  const settings = {
    supportWhatsappUrl: null, facebookUrl: 'https://facebook.com/groups/old', instagramUrl: null, tiktokUrl: null, youtubeUrl: null,
    telegramUrl: null, messengerUrl: null, leaderSignupPhrase: null, contactEmail: null,
    defaultReferrerPersonId: null, defaultReferrerPersonName: null, authorTitle: null, content: {},
  };

  it('turns a typed number into a wa.me link, and a blank link is sent as null so it can be removed', async () => {
    mockFetch({
      'GET /api/admin/settings': () => settings,
      'PATCH /api/admin/settings': (body) => ({ ...settings, ...body }),
    });
    render(<SettingsTab />);
    const input = await screen.findByLabelText('Assistance WhatsApp (number or link)');
    fireEvent.change(input, { target: { value: '+237 670 00 00 00' } });
    // Take the old Facebook link away.
    const facebook = screen.getByLabelText('Facebook');
    await waitFor(() => expect(facebook).toHaveValue('https://facebook.com/groups/old'));
    fireEvent.change(facebook, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const sent = calls.find((c) => c.method === 'PATCH')!.body;
    expect(sent.supportWhatsappUrl).toBe('https://wa.me/237670000000');
    expect(sent.facebookUrl).toBeNull();
    expect(screen.getByText(/It becomes the green Assistance button on the Chats page/)).toBeInTheDocument();
  });
});
