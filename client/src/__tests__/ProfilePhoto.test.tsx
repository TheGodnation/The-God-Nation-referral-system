import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ProfilePhotoEditor } from '../components/member/ProfilePhotoEditor';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

const calls: { url: string; method: string; body: any }[] = [];
let photoUrl: string | null = null;

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      let resBody: unknown = {};
      if (url.includes('/api/member/auth/me')) {
        resBody = { member: { name: 'Jean Ngono', email: 'j@example.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, profileComplete: true, personId: 'p1', photoUrl } };
      } else if (url.includes('/api/member/me/photo/authorize')) {
        resBody = { storageKey: 'people/p1/photo/x', uploadUrl: 'https://upload.example/x' };
      } else if (url === '/api/member/me/photo' && method === 'POST') {
        photoUrl = '/api/people/p1/photo?v=1';
        resBody = { photoUrl };
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => resBody });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  photoUrl = null;
});

describe('Avatar', () => {
  it('shows initials when there is no picture', () => {
    render(<Avatar name="Jean Ngono" />);
    expect(screen.getByRole('img', { name: 'Jean Ngono' })).toHaveTextContent('JN');
  });

  it('shows the picture when there is one', () => {
    render(<Avatar name="Jean Ngono" photoUrl="/api/people/p1/photo?v=1" />);
    expect(screen.getByRole('img', { name: 'Jean Ngono' })).toHaveAttribute('src', '/api/people/p1/photo?v=1');
  });
});

describe('ProfilePhotoEditor', () => {
  function renderEditor() {
    return render(
      <MemoryRouter>
        <MemberAuthProvider>
          <ProfilePhotoEditor />
        </MemberAuthProvider>
      </MemoryRouter>,
    );
  }

  it('uploads a picture: authorize, send to storage, confirm', async () => {
    mockFetch();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a profile picture' })).toBeInTheDocument());

    const file = new File(['x'.repeat(100)], 'me.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add a profile picture', { selector: 'input' }), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Change picture' })).toBeInTheDocument());
    expect(calls.some((c) => c.url === 'https://upload.example/x' && c.method === 'PUT')).toBe(true);
    const confirm = calls.find((c) => c.url === '/api/member/me/photo' && c.method === 'POST');
    expect(confirm?.body).toEqual({ storageKey: 'people/p1/photo/x', mimeType: 'image/jpeg', byteSize: 100 });
  });

  it('refuses a non-image file without contacting the server', async () => {
    mockFetch();
    renderEditor();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a profile picture' })).toBeInTheDocument());
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Add a profile picture', { selector: 'input' }), { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose a JPG, PNG or WebP picture.');
    expect(calls.some((c) => c.url.includes('/photo/authorize'))).toBe(false);
  });
});
