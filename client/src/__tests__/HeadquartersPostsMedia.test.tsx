import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HeadquartersPosts } from '../components/HeadquartersPosts';
import i18n from '../i18n';

// Media Phase 1 — Member/Leader recipient media rendering. Same
// URL-dispatching fetch mock pattern established by
// HeadquartersPosts.test.tsx.
const calls: { url: string; method: string }[] = [];

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
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
  i18n.changeLanguage('en');
});

const BASE_POST = {
  id: 'p1',
  titleEn: 'Network Update',
  titleFr: null,
  bodyEn: 'A message from headquarters.',
  bodyFr: null,
  publishedAt: '2026-01-01T00:00:00Z',
  networkWide: true,
  commentCount: 0,
  reactionCount: 0,
  viewerHasReacted: false,
};

function postWithMedia(mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF', originalFilename: string) {
  return { ...BASE_POST, media: { mediaType, originalFilename, byteSize: 2048 } };
}

async function openDetail() {
  render(<HeadquartersPosts />);
  fireEvent.click(await screen.findByText('Read More'));
  await waitFor(() => expect(screen.getByText('A message from headquarters.')).toBeInTheDocument());
}

describe('HeadquartersPosts — media rendering', () => {
  it('renders an actual image preview for IMAGE media', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/img', mediaType: 'IMAGE' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('IMAGE', 'photo.png') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('IMAGE', 'photo.png')] } },
    });

    await openDetail();

    const img = await screen.findByAltText('Image attached to this post');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('https://mock-r2.example/download/img');
  });

  it('renders a native video player with controls for VIDEO media', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/vid', mediaType: 'VIDEO' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('VIDEO', 'clip.mp4') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('VIDEO', 'clip.mp4')] } },
    });

    await openDetail();

    await waitFor(() => {
      const video = document.querySelector('video');
      expect(video).toBeTruthy();
      expect(video).toHaveAttribute('controls');
      expect(video).toHaveAttribute('src', 'https://mock-r2.example/download/vid');
    });
  });

  it('renders a native audio player with controls for AUDIO media', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/aud', mediaType: 'AUDIO' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('AUDIO', 'sermon.mp3') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('AUDIO', 'sermon.mp3')] } },
    });

    await openDetail();

    await waitFor(() => {
      const audio = document.querySelector('audio');
      expect(audio).toBeTruthy();
      expect(audio).toHaveAttribute('controls');
      expect(audio).toHaveAttribute('src', 'https://mock-r2.example/download/aud');
    });
  });

  it('renders a clear open/download action for PDF media, not a plain text URL', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/pdf', mediaType: 'PDF' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('PDF', 'handout.pdf') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('PDF', 'handout.pdf')] } },
    });

    await openDetail();

    const link = await screen.findByText(/Open PDF \(handout\.pdf\)/);
    expect(link.closest('a')).toHaveAttribute('href', 'https://mock-r2.example/download/pdf');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');
    // Never the raw storage URL rendered as plain unexplained text.
    expect(screen.queryByText('https://mock-r2.example/download/pdf')).not.toBeInTheDocument();
  });

  it('renders no media element at all when the post has no media', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1': { status: 200, body: { ...BASE_POST, media: null } },
      '/api/me/headquarters-posts': { status: 200, body: { items: [{ ...BASE_POST, media: null }] } },
    });

    await openDetail();

    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.queryByAltText('Image attached to this post')).not.toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/media/download-url'))).toBeUndefined();
  });

  it('never renders media the caller is not authorized for (a failed/absent download-url yields no media element)', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 404, body: { error: 'not found' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('IMAGE', 'photo.png') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('IMAGE', 'photo.png')] } },
    });

    await openDetail();

    await waitFor(() => expect(screen.getByText('Failed to load media.')).toBeInTheDocument());
    expect(screen.queryByAltText('Image attached to this post')).not.toBeInTheDocument();
  });

  it('renders the PDF action label in French', async () => {
    i18n.changeLanguage('fr');
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/pdf', mediaType: 'PDF' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('PDF', 'handout.pdf') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('PDF', 'handout.pdf')] } },
    });

    render(<HeadquartersPosts />);
    fireEvent.click(await screen.findByText('Lire la suite'));
    await waitFor(() => expect(screen.getByText('A message from headquarters.')).toBeInTheDocument());

    expect(await screen.findByText(/Ouvrir le PDF \(handout\.pdf\)/)).toBeInTheDocument();
  });

  it('existing comments and reactions remain intact on a post with media', async () => {
    mockFetchByUrl({
      '/api/me/headquarters-posts/p1/comments': { status: 200, body: { items: [], hasMore: false } },
      '/api/me/headquarters-posts/p1/media/download-url': { status: 200, body: { url: 'https://mock-r2.example/download/img', mediaType: 'IMAGE' } },
      '/api/me/headquarters-posts/p1': { status: 200, body: postWithMedia('IMAGE', 'photo.png') },
      '/api/me/headquarters-posts': { status: 200, body: { items: [postWithMedia('IMAGE', 'photo.png')] } },
    });

    await openDetail();

    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    expect(screen.getByText('0 reactions')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(await screen.findByAltText('Image attached to this post')).toBeInTheDocument();
  });
});
