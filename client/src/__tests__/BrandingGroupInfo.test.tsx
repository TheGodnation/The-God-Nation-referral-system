import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UpdatesBanner } from '../components/updates/UpdatesBanner';
import { MemberGroupInfoPage } from '../pages/MemberGroupInfoPage';
import { MemberChatsPage } from '../pages/MemberChatsPage';
import { GroupDetailsEditor } from '../components/admin/GroupDetailsEditor';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
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
          return m === method && url.split('?')[0] === path;
        });
      const res = key ? routes[key](body) : { status: 404, body: {} };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  localStorage.clear();
});

describe('Updates banner', () => {
  it('shows the picture, the slogan and Mission / Vision / Purpose', async () => {
    mockFetch({
      'GET /api/settings/public': () => ({
        body: {
          content: { appSloganEn: 'Raising kingdom leaders', appMissionEn: 'To train leaders.', appVisionEn: 'A nation for God.', appPurposeEn: 'To serve.' },
          appBannerUrl: '/api/app-banner?v=1',
        },
      }),
    });
    const { container } = render(<UpdatesBanner />);
    expect(await screen.findByText('Raising kingdom leaders')).toBeInTheDocument();
    expect(screen.getByText('📌 Mission')).toBeInTheDocument();
    expect(screen.getByText('To train leaders.')).toBeInTheDocument();
    expect(screen.getByText('👁 Vision')).toBeInTheDocument();
    expect(screen.getByText('🎯 Purpose')).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/app-banner?v=1"]')).not.toBeNull();
  });

  it('with Save data on, shows colours instead of the picture', async () => {
    localStorage.setItem('dataSaver', 'on');
    mockFetch({ 'GET /api/settings/public': () => ({ body: { content: {}, appBannerUrl: '/api/app-banner?v=1' } }) });
    const { container } = render(<UpdatesBanner />);
    expect(await screen.findByText('THE GOD NATION')).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/app-banner?v=1"]')).toBeNull();
  });
});

describe('Group info page', () => {
  it('shows the picture, name, purpose, leaders and who is online', async () => {
    mockFetch({
      'GET /api/communities/g1/conversation': () => ({ body: { name: 'Buea Group', photoUrl: null, aboutEn: 'We pray for Buea every morning.', aboutFr: null, unreadCount: 0 } }),
      'GET /api/communities/g1/conversation/members': () => ({
        body: {
          members: [
            { personId: 'p1', name: 'Pastor Ben', photoUrl: null, isLeader: true, isYou: false, online: true },
            { personId: 'p2', name: 'Ada Obi', photoUrl: null, isLeader: false, isYou: false, online: false },
            { personId: 'me', name: 'Me Myself', photoUrl: null, isLeader: false, isYou: true, online: true },
          ],
        },
      }),
    });
    render(
      <MemoryRouter initialEntries={['/member/chats/group/g1/info']}>
        <Routes>
          <Route path="/member/chats/group/:communityId/info" element={<MemberGroupInfoPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Buea Group' })).toBeInTheDocument();
    expect(screen.getByText('We pray for Buea every morning.')).toBeInTheDocument();
    expect(await screen.findByText('3 members · 2 online')).toBeInTheDocument();
    const leaders = screen.getByRole('heading', { name: 'Leaders' }).closest('section')!;
    expect(within(leaders).getByText('Pastor Ben')).toBeInTheDocument();
    expect(within(leaders).getByRole('img', { name: 'online' })).toBeInTheDocument();
    expect(screen.getByText('Members (2)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ada Obi/ })).toHaveAttribute('href', '/member/people/p2');
  });
});

describe('Chats list group row', () => {
  it('shows the last message like WhatsApp', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: 'g1', communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      'GET /api/communities/g1/conversation': () => ({
        body: {
          unreadCount: 2,
          name: 'Buea Group',
          photoUrl: '/api/group-photos/g1?v=1',
          lastMessage: { senderName: 'Grace Ngwa', isOwn: false, body: 'Amen 🙏', deleted: false, attachmentMimeType: null, createdAt: new Date().toISOString() },
        },
      }),
    });
    render(
      <MemoryRouter>
        <MemberChatsPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole('link', { name: /Buea Group/ });
    await waitFor(() => expect(row).toHaveTextContent('Grace: Amen 🙏'));
    expect(within(row).getByAltText('Buea Group')).toHaveAttribute('src', '/api/group-photos/g1?v=1');
    expect(within(row).getByLabelText('2 new messages')).toBeInTheDocument();
  });
});

describe('Admin: group picture and purpose', () => {
  it('saves the purpose in English and French', async () => {
    mockFetch({
      'GET /api/admin/communities/g1/details': () => ({ body: { photoUrl: null, aboutEn: 'Old', aboutFr: null } }),
      'PATCH /api/admin/communities/g1/about': () => ({ body: { aboutEn: 'New purpose', aboutFr: 'Nouveau but' } }),
    });
    render(<GroupDetailsEditor communityId="g1" communityName="Buea Group" />);
    const en = await screen.findByLabelText('Purpose / vision (English)');
    await waitFor(() => expect(en).toHaveValue('Old'));
    fireEvent.change(en, { target: { value: 'New purpose' } });
    fireEvent.change(screen.getByLabelText('Purpose / vision (French)'), { target: { value: 'Nouveau but' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ aboutEn: 'New purpose', aboutFr: 'Nouveau but' });
  });
});
