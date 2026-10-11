import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAuthProvider } from '../lib/MemberAuthContext';
import { MemberMePage } from '../pages/MemberMePage';
import { MemberEditProfilePage } from '../pages/MemberEditProfilePage';

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
  calls.length = 0;
});

const ME = {
  member: {
    name: 'Grace Ngwa',
    email: 'grace@example.com',
    preferredLanguage: 'en',
    locationCountry: 'Cameroon',
    locationCity: 'Buea',
    locationArea: 'Molyko',
    personId: 'me1',
    photoUrl: null,
    coverUrl: '/api/people/me1/cover?v=1',
    bio: 'Serving God in Buea',
  },
};

const EMPTY_FEED = { viewer: { canPost: true, canModerate: false, personId: 'me1' }, items: [], nextBefore: null };

function baseRoutes(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  return {
    'GET /api/member/auth/me': () => ({ body: ME }),
    'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: 'g1', communityName: 'Buea Group', status: 'ACTIVE' }] } }),
    'GET /api/member/friends': () => ({ body: { items: [{}, {}] } }),
    'GET /api/updates': () => ({ body: EMPTY_FEED }),
    ...extra,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/me" element={<MemberMePage />} />
          <Route path="/member/me/edit" element={<MemberEditProfilePage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Me wall', () => {
  it('shows the cover, name, short line and group — but not private details', async () => {
    mockFetch(baseRoutes());
    renderAt('/member/me');
    expect(await screen.findByRole('heading', { name: 'Grace Ngwa' })).toBeInTheDocument();
    expect(screen.getByAltText("Grace Ngwa's cover picture")).toHaveAttribute('src', '/api/people/me1/cover?v=1');
    expect(screen.getByText('Serving God in Buea')).toBeInTheDocument();
    expect(await screen.findByText('Buea Group · 2 friends')).toBeInTheDocument();
    expect(screen.queryByText(/Molyko/)).not.toBeInTheDocument();
    expect(screen.queryByText(/grace@example.com/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit profile/ })).toHaveAttribute('href', '/member/me/edit');
    // Posts tab first, showing this member's own posts.
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/updates?authorPersonId=me1'))).toBe(true));
  });

  it('Photos tab shows a grid of posted photos', async () => {
    mockFetch(
      baseRoutes({
        'GET /api/updates/photo-wall': () => ({ body: { items: [{ id: 'ph1', postId: 'u1', url: '/api/updates/photos/ph1' }] } }),
      }),
    );
    renderAt('/member/me');
    fireEvent.click(await screen.findByRole('tab', { name: 'Photos' }));
    const btn = await screen.findByRole('button', { name: 'Open photo' });
    expect(btn.querySelector('img')).toHaveAttribute('src', '/api/updates/photos/ph1');
    expect(calls.some((c) => c.url === '/api/updates/photo-wall?authorPersonId=me1')).toBe(true);
  });

  it('My progress tab shows exam scores and books passed', async () => {
    mockFetch(
      baseRoutes({
        'GET /api/member/exam-world': () => ({
          body: {
            offering: { instructionsEn: null, instructionsFr: null },
            devotionals: [{ id: 'd1', titleEn: 'October Devotional', titleFr: null, exams: [{ id: 'e1', weekNumber: 1, firstScore: 85, firstPassed: true }] }],
            training: {
              enrollment: 'ACTIVE',
              books: [
                { id: 'b1', trainingOrder: 1, titleEn: 'Foundations', titleFr: null, exam: { passed: true, bestPercentage: 90 } },
                { id: 'b2', trainingOrder: 2, titleEn: 'Prayer', titleFr: null, exam: null },
              ],
            },
          },
        }),
      }),
    );
    renderAt('/member/me');
    fireEvent.click(await screen.findByRole('tab', { name: 'My progress' }));
    expect(await screen.findByText('Week 1: 85%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 books passed')).toBeInTheDocument();
    expect(screen.getByText(/Book 1: Foundations \(90%\)/)).toBeInTheDocument();
  });

  it('says clearly when pictures cannot be uploaded yet', async () => {
    mockFetch(
      baseRoutes({
        'POST /api/member/me/cover/authorize': () => ({ status: 503, body: { error: 'x', code: 'STORAGE_UNAVAILABLE' } }),
      }),
    );
    renderAt('/member/me');
    await screen.findByRole('heading', { name: 'Grace Ngwa' });
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('cover-input'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Pictures can't be uploaded yet");
  });
});

describe('Edit profile', () => {
  it('saves name, short line and private details, then goes back to the wall', async () => {
    mockFetch(
      baseRoutes({
        'PATCH /api/member/me/profile': () => ({ body: { name: 'Grace N.', bio: 'Praying daily' } }),
      }),
    );
    renderAt('/member/me/edit');
    const bio = await screen.findByLabelText('About me');
    expect(bio).toHaveValue('Serving God in Buea');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace N.' } });
    fireEvent.change(bio, { target: { value: 'Praying daily' } });
    expect(screen.getByText('13/160')).toBeInTheDocument();
    expect(screen.getByText(/Only you and the leaders see these/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({
        name: 'Grace N.',
        bio: 'Praying daily',
        preferredLanguage: 'en',
        locationCountry: 'Cameroon',
        locationCity: 'Buea',
        locationArea: 'Molyko',
      });
    });
    expect(await screen.findByRole('tab', { name: 'Posts' })).toBeInTheDocument();
  });
});
