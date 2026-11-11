import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BroadcastComposer } from '../components/leader/BroadcastComposer';
import { BroadcastLogPanel } from '../components/admin/BroadcastLogPanel';
import { MemberPersonPage } from '../pages/MemberPersonPage';

const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
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
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  calls.length = 0;
});

const B = '/api/member/broadcast';
const people = [{ id: 'a', name: 'Ada Nkem' }, { id: 'm', name: 'Marie Claire' }, { id: 'p', name: 'Paul Eto' }];

describe('BroadcastComposer (a leader)', () => {
  it('sends one message to everyone they look after', async () => {
    mockFetch({
      [`GET ${B}/people`]: () => ({ body: { items: people } }),
      [`GET ${B}/mine`]: () => ({ body: { items: [] } }),
      [`POST ${B}`]: () => ({ status: 201, body: { id: 'b1', recipients: 3, skipped: 0 } }),
    });
    render(<BroadcastComposer />);
    expect(await screen.findByTestId('broadcast-count')).toHaveTextContent('This will go to 3 people.');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'God is faithful' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 3 people.');
    const post = calls.find((c) => c.method === 'POST' && c.url === B);
    expect(post?.body).toMatchObject({ body: 'God is faithful' });
    expect(post?.body.personIds).toBeUndefined(); // everyone: no list needed
  });

  it('tells a leader how many of their people read English and French, and warns about a mix', async () => {
    mockFetch({
      [`GET ${B}/people`]: () => ({ body: { items: [{ id: 'a', name: 'Ada Nkem', language: 'en' }, { id: 'm', name: 'Marie Claire', language: 'fr' }, { id: 'p', name: 'Paul Eto', language: 'fr' }] } }),
      [`GET ${B}/mine`]: () => ({ body: { items: [] } }),
    });
    render(<BroadcastComposer />);
    await screen.findByTestId('broadcast-count');
    expect(screen.getByTestId('broadcast-languages')).toHaveTextContent('1 English speakers, 2 French speakers');
    expect(screen.getByTestId('broadcast-mixed-warning')).toHaveTextContent('private messages are not translated');
    fireEvent.click(screen.getByRole('button', { name: 'Choose who gets it' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Nkem' }));
    expect(screen.queryByTestId('broadcast-mixed-warning')).toBeNull();
  });

  it('can leave some people out, and refuses to send to nobody', async () => {
    mockFetch({
      [`GET ${B}/people`]: () => ({ body: { items: people } }),
      [`GET ${B}/mine`]: () => ({ body: { items: [{ id: 'b0', senderName: 'Me', body: 'Earlier note', recipientCount: 3, skippedCount: 0, attachmentCount: 1, createdAt: '2026-11-08T10:00:00Z' }] } }),
      [`POST ${B}`]: () => ({ status: 201, body: { id: 'b1', recipients: 2, skipped: 1 } }),
    });
    render(<BroadcastComposer />);
    await screen.findByTestId('broadcast-count');
    fireEvent.click(screen.getByRole('button', { name: 'Choose who gets it' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paul Eto' }));
    expect(screen.getByTestId('broadcast-count')).toHaveTextContent('This will go to 2 people.');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Just two of you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 2 people. 1 could not be reached.');
    expect(calls.find((c) => c.method === 'POST' && c.url === B)?.body.personIds).toEqual(['a', 'm']);
    expect(await screen.findByText('Earlier note')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'To nobody' } });
    const before = calls.filter((c) => c.method === 'POST').length;
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one person.');
    expect(calls.filter((c) => c.method === 'POST').length).toBe(before);
  });

  it('tells a leader with nobody assigned that there is no one to message', async () => {
    mockFetch({ [`GET ${B}/people`]: () => ({ body: { items: [] } }), [`GET ${B}/mine`]: () => ({ body: { items: [] } }) });
    render(<BroadcastComposer />);
    expect(await screen.findByText(/You do not look after anyone yet/)).toBeInTheDocument();
  });
});

describe('BroadcastLogPanel (the central admin or a representative)', () => {
  it('lists every group message with who sent it, when, to how many, and what it said', async () => {
    mockFetch({
      'GET /api/member/central-broadcast-log': () => ({
        body: { items: [
          { id: '1', senderName: 'Leo Leader', body: 'Come on Sunday', recipientCount: 12, skippedCount: 1, attachmentCount: 2, createdAt: '2026-11-08T10:00:00Z' },
          { id: '2', senderName: 'Rita Rep', body: '', recipientCount: 1, skippedCount: 0, attachmentCount: 1, createdAt: '2026-11-07T10:00:00Z' },
        ] },
      }),
    });
    render(<BroadcastLogPanel base="/api/member/central-broadcast-log" />);
    const entries = await screen.findAllByTestId('broadcast-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Leo Leader');
    expect(entries[0]).toHaveTextContent('to 12 people');
    expect(entries[0]).toHaveTextContent('2 files');
    expect(entries[0]).toHaveTextContent('1 not delivered');
    expect(entries[0]).toHaveTextContent('Come on Sunday');
    expect(entries[1]).toHaveTextContent('to 1 person');
  });

  it('says clearly when nothing was sent yet or it cannot be opened', async () => {
    mockFetch({ 'GET /api/member/rep-broadcast-log': () => ({ body: { items: [] } }) });
    const { unmount } = render(<BroadcastLogPanel base="/api/member/rep-broadcast-log" />);
    expect(await screen.findByText('No group messages yet.')).toBeInTheDocument();
    unmount();
    mockFetch({ 'GET /api/member/rep-broadcast-log': () => ({ status: 403, body: { error: 'Only the representative of a generation can use this.' } }) });
    render(<BroadcastLogPanel base="/api/member/rep-broadcast-log" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the representative');
  });
});

describe('Blocking someone who looks after you', () => {
  it('shows why when the person cannot be blocked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetch({
      'GET /api/member/people/leo': () => ({
        body: { personId: 'leo', name: 'Leo Leader', photoUrl: null, area: null, isLeader: true, leaderOf: ['Alpha'], memberOf: [], areaLeaderOf: [], sameGroup: true, friendStatus: 'NONE', requestId: null, referredCount: 0, communityCount: 0, friendCount: 0, followerCount: 0, followingCount: 0, isFollowing: false, canMessage: true },
      }),
      'POST /api/member/blocks': () => ({ status: 403, body: { error: 'This person looks after your community, so they cannot be blocked.', code: 'CANNOT_BLOCK' } }),
    });
    const { MemoryRouter: Router, Routes, Route } = await import('react-router-dom');
    render(
      <Router initialEntries={['/member/people/leo']}>
        <Routes>
          <Route path="/member/people/:personId" element={<MemberPersonPage />} />
        </Routes>
      </Router>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('so they cannot be blocked');
  });
});
void MemoryRouter; void waitFor; void within;
