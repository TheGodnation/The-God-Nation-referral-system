import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminWallpaperPicker } from '../components/admin/AdminWallpaperPicker';

// Admin: one wallpaper for everyone (Home page or chat), a built-in
// preset or an uploaded custom image. Same URL-dispatching fetch mock
// pattern established by wallpaper.test.ts (server) and
// HeadquartersPostsTabMedia.test.tsx (client).
const calls: { url: string; method: string; body: unknown }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const bodyIsString = typeof init?.body === 'string';
      calls.push({ url, method: init?.method ?? 'GET', body: bodyIsString ? JSON.parse(init!.body as string) : init?.body });
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.includes(key));
      const res = match ? responses[match] : { status: 404, body: { error: 'not found' } };
      return Promise.resolve({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: () => 'application/json' },
        json: async () => res.body,
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('AdminWallpaperPicker', () => {
  it('shows the current preset as selected, from public settings', async () => {
    mockFetchByUrl({
      '/api/settings/public': { status: 200, body: { homeWallpaper: { preset: 'sky', imageUrl: null }, chatWallpaper: { preset: null, imageUrl: null } } },
    });
    render(<AdminWallpaperPicker target="home" title="Home wallpaper" hint="Shown on the home feed." />);

    const selected = await screen.findByTitle('Sky');
    await waitFor(() => expect(selected.className).toContain('border-brand-600'));
  });

  it('choosing a preset saves it and marks it selected', async () => {
    mockFetchByUrl({
      '/api/settings/public': { status: 200, body: { homeWallpaper: { preset: null, imageUrl: null } } },
      '/api/admin/wallpaper/home': { status: 200, body: { target: 'home', preset: 'sage', imageUrl: null } },
    });
    render(<AdminWallpaperPicker target="home" title="Home wallpaper" hint="Shown on the home feed." />);
    await screen.findByTitle('Classic');

    fireEvent.click(screen.getByTitle('Sage'));

    await waitFor(() => expect(screen.getByTitle('Sage').className).toContain('border-brand-600'));
    const saveCall = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/api/admin/wallpaper/home'));
    expect(saveCall?.body).toEqual({ preset: 'sage' });
  });

  it('uploading a custom image replaces the preset swatches with a preview', async () => {
    // load() re-fetches /api/settings/public after a successful upload, so
    // this mock reflects the image once the finalize call has happened —
    // a static response would hide a real app bug behind a stale refetch.
    let uploaded = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const bodyIsString = typeof init?.body === 'string';
        calls.push({ url, method, body: bodyIsString ? JSON.parse(init!.body as string) : init?.body });
        if (url.includes('/api/settings/public')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ chatWallpaper: uploaded ? { preset: null, imageUrl: '/api/wallpaper/chat?v=123' } : { preset: 'blush', imageUrl: null } }),
          });
        }
        if (url.includes('/api/admin/wallpaper/chat/authorize')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ storageKey: 'settings/wallpaper/chat/abc', uploadUrl: 'https://mock-r2.example/upload/abc' }),
          });
        }
        if (url.includes('mock-r2.example/upload')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });
        }
        if (url.endsWith('/api/admin/wallpaper/chat') && method === 'POST') {
          uploaded = true;
          return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ target: 'chat', preset: null, imageUrl: '/api/wallpaper/chat?v=123' }) });
        }
        return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({ error: 'not found' }) });
      }),
    );
    const { container } = render(<AdminWallpaperPicker target="chat" title="Chat wallpaper" hint="Shown behind chat messages." />);
    await screen.findByTitle('Blush');

    const file = new File(['x'.repeat(10)], 'bg.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chat wallpaper'), { target: { files: [file] } });

    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', '/api/wallpaper/chat?v=123');
    });
    const uploadCall = calls.find((c) => c.method === 'PUT' && c.url.includes('mock-r2.example/upload'));
    expect(uploadCall).toBeTruthy();
    const finalizeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/wallpaper/chat'));
    expect(finalizeCall).toBeTruthy();
  });

  it('shows an error when saving a preset fails', async () => {
    mockFetchByUrl({
      '/api/settings/public': { status: 200, body: { homeWallpaper: { preset: null, imageUrl: null } } },
      '/api/admin/wallpaper/home': { status: 500, body: { error: 'boom' } },
    });
    render(<AdminWallpaperPicker target="home" title="Home wallpaper" hint="Shown on the home feed." />);
    await screen.findByTitle('Classic');

    fireEvent.click(screen.getByTitle('Sky'));

    expect(await screen.findByText('Could not save this background. Please try again.')).toBeInTheDocument();
  });

  it('Reset to default clears the current choice', async () => {
    mockFetchByUrl({
      '/api/settings/public': { status: 200, body: { homeWallpaper: { preset: 'sand', imageUrl: null } } },
      '/api/admin/wallpaper/home': { status: 200, body: { target: 'home', preset: null, imageUrl: null } },
    });
    render(<AdminWallpaperPicker target="home" title="Home wallpaper" hint="Shown on the home feed." />);
    await screen.findByTitle('Sand');

    fireEvent.click(screen.getByText('Reset to default'));

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'DELETE' && c.url.endsWith('/api/admin/wallpaper/home'))).toBeTruthy();
    });
    expect(screen.queryByText('Reset to default')).not.toBeInTheDocument();
  });
});
