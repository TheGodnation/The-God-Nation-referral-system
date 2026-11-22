import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LinkPreviewCard, firstUrl, clearLinkPreviewCache } from '../components/LinkPreviewCard';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
beforeEach(() => clearLinkPreviewCache());
afterEach(() => vi.unstubAllGlobals());

const CARD = { url: 'https://news.example/a', title: 'A good story', description: 'The first lines of it.', image: 'https://news.example/a.jpg', site: 'news.example' };

describe('finding the link in a message', () => {
  it('takes the first web link and leaves the punctuation that ends a sentence', () => {
    expect(firstUrl('Read this: https://news.example/a, then https://other.example')).toBe('https://news.example/a');
    expect(firstUrl('See (https://news.example/a).')).toBe('https://news.example/a');
    expect(firstUrl('no link here')).toBeNull();
    expect(firstUrl(null)).toBeNull();
  });
});

describe('the card under a link', () => {
  it('shows the picture, title and first lines, and opens the link in a new tab', async () => {
    const fetchMock = vi.fn(() => json({ preview: CARD }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LinkPreviewCard text="Look https://news.example/a" />);
    const card = await screen.findByTestId('link-preview');
    expect(card).toHaveTextContent('A good story');
    expect(card).toHaveTextContent('The first lines of it.');
    expect(card).toHaveTextContent('news.example');
    expect(card).toHaveAttribute('href', 'https://news.example/a');
    expect(card).toHaveAttribute('target', '_blank');
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://news.example/a.jpg');
    expect(String((fetchMock.mock.calls as unknown as string[][])[0][0])).toContain('/api/member/link-preview?url=https%3A%2F%2Fnews.example%2Fa');
  });

  it('asks once for the same link, however many messages carry it', async () => {
    const fetchMock = vi.fn(() => json({ preview: CARD }));
    vi.stubGlobal('fetch', fetchMock);
    render(<><LinkPreviewCard text="https://news.example/a" /><LinkPreviewCard text="again https://news.example/a" /></>);
    await waitFor(() => expect(screen.getAllByTestId('link-preview')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a message with no link, or for a link with no preview, or when the answer cannot be had', async () => {
    const fetchMock = vi.fn(() => json({ preview: null }));
    vi.stubGlobal('fetch', fetchMock);
    const none = render(<LinkPreviewCard text="just words" />);
    expect(none.container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
    none.unmount();
    const empty = render(<LinkPreviewCard text="https://nothing.example/" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const offline = render(<LinkPreviewCard text="https://offline.example/" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(offline.container).toBeEmptyDOMElement();
  });
});
