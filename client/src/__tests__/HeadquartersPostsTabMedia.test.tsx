import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HeadquartersPostsTab } from '../components/admin/HeadquartersPostsTab';

// Media Phase 1 — Admin media attachment UI. Same URL-dispatching fetch
// mock pattern established by HeadquartersPostsTab.test.tsx, and the same
// file-input/direct-to-R2-PUT simulation pattern established by
// CommunityConversation.test.tsx's own attachment upload test.
const calls: { url: string; method: string; body: unknown }[] = [];

const DRAFT_ROW = {
  id: 'hqp-media-1',
  titleEn: 'Media Draft Post',
  titleFr: null,
  bodyEn: 'Draft body.',
  bodyFr: null,
  networkWide: false,
  createdAt: '2026-01-01T00:00:00Z',
  publishedAt: null,
  archivedAt: null,
  createdBy: { id: 'admin-1', email: 'admin@test.local' },
  targets: [],
  commentCount: 0,
  reactionCount: 0,
  media: null as null | { originalFilename: string; mimeType: string; byteSize: number; mediaType: string },
};

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      // A direct-to-R2 upload sends a raw File as the body, not a JSON
      // string (unlike every call through lib/api.ts) — parse only when it
      // actually looks like JSON, matching CommunityConversation.test.tsx's
      // own mock, so that request doesn't throw here.
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

async function openEditForm() {
  render(<HeadquartersPostsTab />);
  fireEvent.click(await screen.findByText('Edit'));
  await screen.findByText('No media attached yet.');
}

function attachResponses(descriptor: { originalFilename: string; mimeType: string; byteSize: number; mediaType: string }) {
  return {
    // Keys are matched longest-first (see mockFetchByUrl above), so the two
    // post-specific media routes must each be longer than the plain list
    // route they'd otherwise collide with as a substring.
    '/api/admin/headquarters-posts': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    [`/api/admin/headquarters-posts/${DRAFT_ROW.id}/media/authorize`]: {
      status: 200,
      body: { storageKey: `headquarters-posts/${DRAFT_ROW.id}/media/abc`, uploadUrl: 'https://mock-r2.example/upload/abc', maxBytes: 8388608 },
    },
    'mock-r2.example/upload': { status: 200, body: {} },
    [`/api/admin/headquarters-posts/${DRAFT_ROW.id}/media`]: {
      status: 201,
      body: { ...DRAFT_ROW, media: descriptor },
    },
  };
}

describe('HeadquartersPostsTab — media attachment', () => {
  it('attaches an image and shows it as the current media', async () => {
    mockFetchByUrl(attachResponses({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024, mediaType: 'IMAGE' }));
    await openEditForm();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'.repeat(10)], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/photo\.png/)).toBeInTheDocument();
      expect(screen.getByText(/Image/)).toBeInTheDocument();
    });
    const uploadCall = calls.find((c) => c.method === 'PUT' && c.url.includes('mock-r2.example/upload'));
    expect(uploadCall).toBeTruthy();
    const finalizeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith(`/api/admin/headquarters-posts/${DRAFT_ROW.id}/media`));
    expect(finalizeCall).toBeTruthy();
    expect((finalizeCall!.body as any).mimeType).toBe('image/png');
  });

  it('attaches a video and shows it as the current media', async () => {
    mockFetchByUrl(attachResponses({ originalFilename: 'clip.mp4', mimeType: 'video/mp4', byteSize: 2048, mediaType: 'VIDEO' }));
    await openEditForm();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'.repeat(10)], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/clip\.mp4/)).toBeInTheDocument();
      expect(screen.getByText(/Video/)).toBeInTheDocument();
    });
  });

  it('attaches an audio file and shows it as the current media', async () => {
    mockFetchByUrl(attachResponses({ originalFilename: 'sermon.mp3', mimeType: 'audio/mpeg', byteSize: 4096, mediaType: 'AUDIO' }));
    await openEditForm();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'.repeat(10)], 'sermon.mp3', { type: 'audio/mpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/sermon\.mp3/)).toBeInTheDocument();
      expect(screen.getByText(/Audio/)).toBeInTheDocument();
    });
  });

  it('attaches a PDF and shows it as the current media', async () => {
    mockFetchByUrl(attachResponses({ originalFilename: 'handout.pdf', mimeType: 'application/pdf', byteSize: 8192, mediaType: 'PDF' }));
    await openEditForm();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'.repeat(10)], 'handout.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/handout\.pdf/)).toBeInTheDocument();
      expect(screen.getByText(/\(PDF\)/)).toBeInTheDocument();
    });
  });

  it('rejects an unsupported file type before ever calling authorize', async () => {
    mockFetchByUrl({
      '/api/admin/headquarters-posts': { status: 200, body: { items: [DRAFT_ROW], pagination: { totalPages: 1 } } },
    });
    await openEditForm();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'app.exe', { type: 'application/x-msdownload' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Unsupported file type.')).toBeInTheDocument();
    });
    expect(calls.find((c) => c.url.includes('/media/authorize'))).toBeUndefined();
  });

  it('does not show the media section before a draft has been created (no editingId yet)', async () => {
    mockFetchByUrl({ '/api/admin/headquarters-posts': { status: 200, body: { items: [], pagination: { totalPages: 1 } } } });
    render(<HeadquartersPostsTab />);

    fireEvent.click(await screen.findByText('+ New Post'));
    expect(screen.queryByText('Attach Media')).not.toBeInTheDocument();
  });
});
