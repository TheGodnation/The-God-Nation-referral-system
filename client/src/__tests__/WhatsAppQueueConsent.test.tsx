import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WhatsAppQueue, type QueuePerson } from '../components/admin/WhatsAppQueue';
import { NeedsMePanel } from '../components/admin/NeedsMePanel';
import i18n from '../i18n';

// WhatsApp follow-up with consent: a welcome or help message goes to anyone who has not asked us to stop; a nudge only
// to people who agreed (unless the sender chooses to include those who never ticked); people who asked to stop are
// never included.
const people: QueuePerson[] = [
  { personId: 'a', name: 'Agnes Agreed', whatsapp: '+237600000001', language: 'en', consent: 'AGREED' },
  { personId: 'n', name: 'Noah None', whatsapp: '+237600000002', language: 'en', consent: 'NONE' },
  { personId: 'o', name: 'Olive Optedout', whatsapp: '+237600000003', language: 'en', consent: 'OPTED_OUT' },
];

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

const open = (extra: Partial<React.ComponentProps<typeof WhatsAppQueue>> = {}) =>
  render(<WhatsAppQueue people={people} onClose={() => {}} recordContact={() => {}} {...extra} />);
const startLabel = () => screen.getByTestId('queue-start').textContent ?? '';

describe('Queue by message type', () => {
  it('a nudge goes only to people who agreed, and never to someone who asked to stop', () => {
    open();
    expect(screen.getByTestId('queue-kind-nudge')).toBeChecked();
    expect(startLabel()).toMatch(/\b1\b/);
    expect(screen.getByTestId('queue-optedout-note')).toHaveTextContent('1 asked us to stop');
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'We miss you' } });
    fireEvent.click(screen.getByTestId('queue-start'));
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 of 1');
    expect(screen.getByText(/Agnes Agreed/)).toBeInTheDocument();
  });

  it('the sender can choose to include those who never ticked, but not those who asked to stop', () => {
    open();
    fireEvent.click(screen.getByTestId('queue-include-notick'));
    expect(startLabel()).toMatch(/\b2\b/);
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'We miss you' } });
    fireEvent.click(screen.getByTestId('queue-start'));
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 of 2');
    fireEvent.click(screen.getByTestId('queue-skip'));
    expect(screen.getByText(/Noah None/)).toBeInTheDocument();
    expect(screen.queryByText(/Olive Optedout/)).toBeNull();
  });

  it('a welcome or help message goes to everyone who has not asked to stop', () => {
    open();
    fireEvent.click(screen.getByTestId('queue-kind-help'));
    expect(startLabel()).toMatch(/\b2\b/);
    expect(screen.queryByTestId('queue-include-notick')).toBeNull();
    expect(screen.getByTestId('queue-optedout-note')).toBeInTheDocument();
  });

  it('starts on "help" when asked to (people who have not signed in or finished setting up)', () => {
    open({ defaultKind: 'help' });
    expect(screen.getByTestId('queue-kind-help')).toBeChecked();
    expect(startLabel()).toMatch(/\b2\b/);
  });

  it('fills in the welcome text, with each person’s first name in the WhatsApp link', () => {
    open({ defaultKind: 'help' });
    fireEvent.click(screen.getByTestId('queue-template'));
    expect((screen.getByTestId('queue-text-en') as HTMLTextAreaElement).value).toContain('welcome to The God Nation');
    fireEvent.click(screen.getByTestId('queue-start'));
    const href = decodeURIComponent(screen.getByTestId('queue-open').getAttribute('href')!);
    expect(href).toContain('Hello Agnes, welcome to The God Nation');
    expect(href).not.toContain('{name}');
  });

  it('the French templates and labels exist', async () => {
    await i18n.changeLanguage('fr');
    const frPeople: QueuePerson[] = [{ personId: 'f', name: 'Marie Ngono', whatsapp: '+237600000009', language: 'fr', consent: 'AGREED' }];
    render(<WhatsAppQueue people={frPeople} onClose={() => {}} recordContact={() => {}} defaultKind="help" />);
    fireEvent.click(screen.getByTestId('queue-template'));
    expect((screen.getByTestId('queue-text-fr') as HTMLTextAreaElement).value).toContain('bienvenue à The God Nation');
    expect(screen.getByText('Accueil, aide pour se connecter ou terminer l’inscription, ou une réponse')).toBeInTheDocument();
  });

  it('"They asked us to stop" records it and takes them out of the list at once', async () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    open({ onStop, defaultKind: 'help' });
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('queue-start'));
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 of 2');
    expect(screen.getByTestId('queue-consent')).toHaveTextContent('Agreed to WhatsApp messages');
    fireEvent.click(screen.getByTestId('queue-stop'));
    await waitFor(() => expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ personId: 'a' })));
    await waitFor(() => expect(screen.getByTestId('queue-current')).toHaveTextContent('Noah None'));
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 of 1');
    expect(screen.getByTestId('queue-consent')).toHaveTextContent('Did not tick the WhatsApp box');
  });

  it('shows no stop button when there is nothing to record it with', () => {
    open({ defaultKind: 'help' });
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('queue-start'));
    expect(screen.queryByTestId('queue-stop')).toBeNull();
  });
});

describe('The coordinator’s list', () => {
  const calls: { url: string; method: string; body: any }[] = [];
  const B = '/api/member/central-needs-me';
  const counts = { today: 3, needs: 3, all: 3, not_confirmed: 0, profile_incomplete: 0, never_back: 1, quiet: 0, no_leader: 3, leader_silent: 0, not_in_group: 0, mine: 0 };
  const row = (over: Record<string, unknown>) => ({
    personId: 'p', name: 'Person', photoUrl: null, whatsapp: '+237600000001', language: 'en', joinedAt: '2026-11-01T10:00:00Z', status: 'ACTIVE', daysQuiet: null,
    leader: null, mine: false, lastContactAt: null, leaderSilent: false, noLeader: true, notInGroup: false, whatsappConsent: 'NONE', ...over,
  });
  const items = [
    row({ personId: 'p1', name: 'Agnes Agreed', whatsappConsent: 'AGREED' }),
    row({ personId: 'p2', name: 'Noah None' }),
    row({ personId: 'p3', name: 'Olive Optedout', whatsappConsent: 'OPTED_OUT' }),
  ];
  function mock() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        let body: unknown = {};
        if (url.includes('/assemblies')) body = { items: [] };
        else if (method === 'GET') body = { items, total: 3, page: 1, pageSize: 30, capped: false, counts };
        else body = { ok: true };
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );
  }
  afterEach(() => {
    calls.length = 0;
  });

  it('shows each person’s consent, hides the WhatsApp buttons for someone opted out, and the "Opted out" button records it', async () => {
    mock();
    render(<MemoryRouter><NeedsMePanel base={B} /></MemoryRouter>);
    await screen.findByTestId('needs-p1');
    expect(screen.getByTestId('needs-consent-p1')).toHaveTextContent('Agreed to WhatsApp messages');
    expect(screen.getByTestId('needs-consent-p2')).toHaveTextContent('Did not tick the WhatsApp box');
    expect(screen.getByTestId('needs-consent-p3')).toHaveTextContent('Opted out of WhatsApp');
    expect(screen.queryByTestId('needs-stop-p3')).toBeNull();
    expect(screen.getByTestId('needs-filter-never_back')).toHaveTextContent('Never came back (1)');
    fireEvent.click(screen.getByTestId('needs-stop-p2'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${B}/whatsapp-stop`)).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/whatsapp-stop`)?.body).toEqual({ personId: 'p2' });
  });
});
