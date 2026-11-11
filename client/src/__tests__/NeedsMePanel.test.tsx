import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NeedsMePanel } from '../components/admin/NeedsMePanel';
import { PrivateChatList } from '../components/chat/PrivateChatList';
import { resetMyLeaderCacheForTests } from '../lib/useMyLeader';

// "People who need me": the National Coordinator's desk.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any, url: string) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.startsWith(path);
      });
      const res = key ? routes[key](body, url) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const B = '/api/member/central-needs-me';
const counts = { today: 2, needs: 2, all: 5, not_confirmed: 1, profile_incomplete: 0, never_back: 0, quiet: 0, no_leader: 1, leader_silent: 1, not_in_group: 0, mine: 0 };
const person = (over: Record<string, unknown>) => ({
  personId: 'p1', name: 'Ada Nkem', photoUrl: null, whatsapp: '+237600000001', language: 'en', joinedAt: '2026-11-01T10:00:00Z', status: 'ACTIVE', daysQuiet: null,
  leader: null, mine: false, lastContactAt: null, leaderSilent: false, noLeader: true, notInGroup: false, ...over,
});
const items = [
  person({ personId: 'p1', name: 'Ada Nkem' }),
  person({ personId: 'p2', name: 'Ben Tabe', whatsapp: '+237600000002', leader: { personId: 'l1', name: 'Grace Mbah' }, noLeader: false, leaderSilent: true, lastContactAt: new Date(Date.now() - 10 * 86400000).toISOString() }),
];
const listRoute = { [`GET ${B}/assemblies`]: () => ({ body: { items: [{ id: 'c1', name: 'Buea Assembly' }] } }), [`GET ${B}?`]: () => ({ body: { items, total: 2, page: 1, pageSize: 30, capped: false, counts } }) };

const renderPanel = () => render(<MemoryRouter><NeedsMePanel base={B} /></MemoryRouter>);

describe('People who need me (the National Coordinator)', () => {
  it('lists people with their leader, last contact and the WhatsApp buttons', async () => {
    mockFetch(listRoute);
    renderPanel();
    const ada = await screen.findByTestId('needs-p1');
    expect(within(ada).getByText('Ada Nkem')).toBeInTheDocument();
    expect(screen.getByTestId('needs-leader-p1')).toHaveTextContent('No leader yet · never contacted');
    expect(screen.getByTestId('needs-leader-p2')).toHaveTextContent('Leader: Grace Mbah · last contact 10 days ago');
    expect(within(screen.getByTestId('needs-p2')).getByText('Leader not following up')).toBeInTheDocument();
    // The same WhatsApp buttons a leader has.
    expect(screen.getByTestId('followup-hello-p1')).toHaveAttribute('href', expect.stringContaining('wa.me'));
    expect(screen.getByTestId('needs-filter-needs')).toHaveTextContent('Need me (2)');
  });

  it('a filter asks the server for that kind of person', async () => {
    mockFetch(listRoute);
    renderPanel();
    await screen.findByTestId('needs-p1');
    fireEvent.click(screen.getByTestId('needs-filter-leader_silent'));
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.url.includes('filter=leader_silent'))).toBe(true));
  });

  it('takes a person over', async () => {
    mockFetch({ ...listRoute, [`POST ${B}/take-over`]: () => ({ body: { changed: true } }) });
    renderPanel();
    fireEvent.click(await screen.findByTestId('needs-takeover-p2'));
    expect(await screen.findByRole('status')).toHaveTextContent('Ben Tabe is now on your list.');
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/take-over`)?.body).toEqual({ personId: 'p2' });
  });

  it('records a contact on someone already taken over', async () => {
    const mine = [person({ personId: 'p3', name: 'Chantal Mbah', mine: true, noLeader: false })];
    mockFetch({ ...listRoute, [`GET ${B}?`]: () => ({ body: { items: mine, total: 1, page: 1, pageSize: 30, capped: false, counts } }), [`POST ${B}/contacted`]: () => ({ status: 201, body: { id: 'c' } }) });
    renderPanel();
    expect(await screen.findByTestId('needs-leader-p3')).toHaveTextContent('I follow up this person');
    expect(screen.queryByTestId('needs-takeover-p3')).toBeNull();
    fireEvent.click(screen.getByTestId('needs-contacted-p3'));
    fireEvent.change(screen.getByLabelText('How are they?'), { target: { value: 'NEEDS_ATTENTION' } });
    fireEvent.change(screen.getByPlaceholderText('A short note (optional)'), { target: { value: 'Needs prayer' } });
    fireEvent.click(screen.getByTestId('needs-save-contact-p3'));
    expect(await screen.findByRole('status')).toHaveTextContent('Contact with Chantal Mbah saved.');
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/contacted`)?.body).toEqual({ personId: 'p3', wellbeing: 'NEEDS_ATTENTION', note: 'Needs prayer' });
  });

  it('writes to the people selected, from the coordinator', async () => {
    mockFetch({
      ...listRoute,
      [`GET ${B}/ids`]: () => ({ body: { ids: ['p1', 'p2'], total: 2 } }),
      [`POST ${B}/message`]: () => ({ status: 201, body: { id: 'b', recipients: 2, skipped: 0 } }),
    });
    renderPanel();
    await screen.findByTestId('needs-p1');
    expect(screen.getByTestId('needs-write')).toBeDisabled();
    fireEvent.click(screen.getByTestId('needs-select-all'));
    await waitFor(() => expect(screen.getByTestId('needs-selected')).toHaveTextContent('2 selected'));
    fireEvent.click(screen.getByTestId('needs-write'));
    expect(screen.getByText(/as National Coordinator/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'God bless you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 2 people.');
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/message`)?.body).toMatchObject({ personIds: ['p1', 'p2'], body: 'God bless you' });
  });
});

describe('Today\'s 20, the WhatsApp queue and the leader alerts', () => {
  it('opens on Today\'s 20, says how many were reached today, and lets the coordinator record a contact on anyone', async () => {
    mockFetch({
      ...listRoute,
      [`GET ${B}?`]: () => ({ body: { items, total: 2, page: 1, pageSize: 30, capped: false, counts, contactedToday: 3 } }),
      [`POST ${B}/contacted`]: () => ({ status: 201, body: { id: 'c' } }),
    });
    renderPanel();
    await screen.findByTestId('needs-p1');
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('filter=today'))).toBe(true);
    expect(screen.getByTestId('needs-filter-today')).toHaveTextContent("Today's 20 (2)");
    expect(screen.getByTestId('needs-today-done')).toHaveTextContent('You have reached out to 3 people today.');
    // "I contacted" is there for someone nobody follows up yet (no take over needed first).
    fireEvent.click(screen.getByTestId('needs-contacted-p1'));
    fireEvent.click(screen.getByTestId('needs-save-contact-p1'));
    expect(await screen.findByRole('status')).toHaveTextContent('Contact with Ada Nkem saved.');
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/contacted`)?.body).toMatchObject({ personId: 'p1', wellbeing: 'GOOD' });
  });

  it('goes through the selected people one by one on WhatsApp, in each person\'s language, recording each contact', async () => {
    window.open = vi.fn();
    mockFetch({
      ...listRoute,
      [`GET ${B}/ids`]: () => ({ body: { ids: ['p1', 'p2'], total: 2, people: [
        { personId: 'p1', name: 'Ada Nkem', whatsapp: '+237600000001', language: 'en' },
        { personId: 'p2', name: 'Ben Tabe', whatsapp: '+237600000002', language: 'fr' },
        ] } }),
      [`POST ${B}/contacted`]: () => ({ status: 201, body: { id: 'c' } }),
    });
    renderPanel();
    await screen.findByTestId('needs-p1');
    fireEvent.click(screen.getByTestId('needs-select-all'));
    await waitFor(() => expect(screen.getByTestId('needs-selected')).toHaveTextContent('2 selected'));
    fireEvent.click(screen.getByTestId('needs-queue'));
    fireEvent.click(screen.getByTestId('queue-kind-help'));
    // Both languages need a message before starting.
    expect(screen.getByTestId('queue-start')).toBeDisabled();
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'God bless you, how are you?' } });
    expect(screen.getByTestId('queue-start')).toBeDisabled();
    fireEvent.change(screen.getByTestId('queue-text-fr'), { target: { value: 'Que Dieu vous bénisse, comment allez-vous ?' } });
    fireEvent.click(screen.getByTestId('queue-start'));

    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 of 2');
    let href = decodeURIComponent(screen.getByTestId('queue-open').getAttribute('href')!);
    expect(href).toContain('wa.me/237600000001');
    expect(href).toContain('God bless you, how are you?');
    expect(href).toContain('— National Coordinator, The God Nation');
    fireEvent.click(screen.getByTestId('queue-next'));
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('2 of 2');
    href = decodeURIComponent(screen.getByTestId('queue-open').getAttribute('href')!);
    expect(href).toContain('wa.me/237600000002');
    expect(href).toContain('Que Dieu vous bénisse');
    expect(href).toContain('— Coordinateur national, The God Nation');
    fireEvent.click(screen.getByTestId('queue-skip'));
    expect(await screen.findByTestId('queue-finished')).toHaveTextContent('All done: 1 contacted, 1 skipped.');
    const recorded = calls.filter((c) => c.method === 'POST' && c.url === `${B}/contacted`);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].body).toMatchObject({ personId: 'p1', note: 'WhatsApp' });
  });

  it('for a mix of languages the coordinator checks the translation first, then each person gets their own language', async () => {
    mockFetch({
      ...listRoute,
      [`GET ${B}/ids`]: () => ({ body: { ids: ['p1', 'p2'], total: 2, people: [
        { personId: 'p1', name: 'Ada Nkem', whatsapp: '+237600000001', language: 'en' },
        { personId: 'p2', name: 'Ben Tabe', whatsapp: '+237600000002', language: 'fr' },
        ] } }),
      [`POST ${B}/translate-preview`]: () => ({ body: { detectedLanguage: 'en', translatedBody: 'Dieu vous bénisse' } }),
      [`POST ${B}/message`]: () => ({ status: 201, body: { id: 'b', recipients: 2, skipped: 0 } }),
    });
    renderPanel();
    await screen.findByTestId('needs-p1');
    fireEvent.click(screen.getByTestId('needs-select-all'));
    await waitFor(() => expect(screen.getByTestId('needs-selected-languages')).toHaveTextContent('1 English speakers, 1 French speakers'));
    fireEvent.click(screen.getByTestId('needs-write'));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'God bless you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByTestId('translation-preview')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.url === `${B}/message`)).toHaveLength(0);
    fireEvent.click(screen.getByTestId('preview-send'));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 2 people.');
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/message`)?.body).toMatchObject({ personIds: ['p1', 'p2'], body: 'God bless you', translation: { language: 'en', body: 'Dieu vous bénisse' } });
  });

  it('in the WhatsApp queue, one message can be translated into the other language box', async () => {
    mockFetch({
      ...listRoute,
      [`GET ${B}/ids`]: () => ({ body: { ids: ['p1', 'p2'], total: 2, people: [
        { personId: 'p1', name: 'Ada Nkem', whatsapp: '+237600000001', language: 'en' },
        { personId: 'p2', name: 'Ben Tabe', whatsapp: '+237600000002', language: 'fr' },
        ] } }),
      [`POST ${B}/translate-preview`]: () => ({ body: { detectedLanguage: 'en', translatedBody: 'Dieu vous bénisse' } }),
    });
    renderPanel();
    await screen.findByTestId('needs-p1');
    fireEvent.click(screen.getByTestId('needs-select-all'));
    await waitFor(() => expect(screen.getByTestId('needs-selected')).toHaveTextContent('2 selected'));
    fireEvent.click(screen.getByTestId('needs-queue'));
    fireEvent.click(screen.getByTestId('queue-kind-help'));
    expect(screen.queryByTestId('queue-translate')).toBeNull();
    fireEvent.change(screen.getByTestId('queue-text-en'), { target: { value: 'God bless you' } });
    fireEvent.click(screen.getByTestId('queue-translate'));
    await waitFor(() => expect(screen.getByTestId('queue-text-fr')).toHaveValue('Dieu vous bénisse'));
    expect(screen.queryByTestId('queue-translate')).toBeNull(); // both boxes filled now
    expect(screen.getByTestId('queue-start')).toBeEnabled();
  });

  it('warns about leaders who are not following up, and takes over all their people on request', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockFetch({
      ...listRoute,
      [`GET ${B}/leader-alerts`]: () => ({ body: { items: [{ personId: 'l1', name: 'Grace Mbah', peopleCount: 4, silentDays: 12 }, { personId: 'l2', name: 'Paul Eto', peopleCount: 1, silentDays: null }] } }),
      [`POST ${B}/take-over-leader`]: () => ({ body: { taken: 4 } }),
    });
    renderPanel();
    const box = await screen.findByTestId('leader-alerts');
    expect(box).toHaveTextContent('Leaders not following up (2)');
    fireEvent.click(within(box).getByRole('button', { name: /Leaders not following up/ }));
    expect(screen.getByTestId('alert-l1')).toHaveTextContent('4 people to look after · no contact for 12 days');
    expect(screen.getByTestId('alert-l2')).toHaveTextContent('has not contacted anyone');
    fireEvent.click(screen.getByTestId('alert-take-l1'));
    expect(await screen.findByText('4 people taken over from Grace Mbah.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === `${B}/take-over-leader`)?.body).toEqual({ leaderPersonId: 'l1' });
  });
});

describe('The National Coordinator label in a person\'s private chats', () => {
  it('shows it beside the coordinator\'s name', async () => {
    resetMyLeaderCacheForTests();
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const body = url.includes('/api/member/my-leader')
        ? { leader: null }
        : { items: [{ id: 'c1', createdAt: '2026-11-10T10:00:00Z', otherPartyType: 'MEMBER', otherPartyName: 'Stanley Ndoh', otherPartyPersonId: 'a1', otherPartyBadge: 'NATIONAL_COORDINATOR', unreadCount: 1, lastMessage: null }] };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
    }));
    render(<MemoryRouter><PrivateChatList /></MemoryRouter>);
    await screen.findByText('Stanley Ndoh');
    expect(await screen.findByText(/National Coordinator/i)).toBeInTheDocument();
  });
});
