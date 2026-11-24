import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../i18n';
import { TeachingLiveBanner } from '../components/chat/TeachingLiveBanner';

// The red banner at the top of a group chat while someone is teaching in it.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

const item = (over = {}) => ({ personId: 'p1', name: 'Ada Ngwa', photoUrl: null, topicEn: 'The Right to Forgiveness', topicFr: 'Le droit au pardon', firstMessageId: 'm1', lastAudioAt: '2026-11-23T06:15:00.000Z', ...over });

describe('Teaching now banner', () => {
  it('shows nothing when nobody is teaching', async () => {
    const fetchMock = vi.fn((_url: string) => json({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<TeachingLiveBanner communityId="g1" onListen={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain('/api/communities/g1/conversation/teaching-now');
    expect(screen.queryByTestId('teaching-live')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('says who is teaching now, with the topic, and Listen takes you to the first audio', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item()] })));
    const onListen = vi.fn();
    render(<TeachingLiveBanner communityId="g1" onListen={onListen} />);
    expect(await screen.findByText('Ada Ngwa is teaching now')).toBeInTheDocument();
    expect(screen.getByText('The Right to Forgiveness')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('teaching-live-listen'));
    expect(onListen).toHaveBeenCalledWith('m1');
  });

  it('is in French for a French reader, and works without a topic', async () => {
    await i18n.changeLanguage('fr');
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item(), item({ personId: 'p2', name: 'Ben Tabe', topicEn: null, topicFr: null, firstMessageId: 'm9' })] })));
    render(<TeachingLiveBanner communityId="g1" onListen={vi.fn()} />);
    expect(await screen.findByText('Ada Ngwa enseigne maintenant')).toBeInTheDocument();
    expect(screen.getByText('Le droit au pardon')).toBeInTheDocument();
    expect(screen.getByText('Ben Tabe enseigne maintenant')).toBeInTheDocument();
    expect(screen.getAllByText('Écouter')).toHaveLength(2);
    expect(screen.getAllByTestId('teaching-live-item')).toHaveLength(2);
  });

  it('looks again when the chat gets a new message, so it appears within moments of the first audio, and goes when the teaching ends', async () => {
    let answer: unknown = { items: [] };
    const fetchMock = vi.fn(() => json(answer));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<TeachingLiveBanner communityId="g1" refreshKey="a" onListen={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('teaching-live')).toBeNull();
    answer = { items: [item()] };
    rerender(<TeachingLiveBanner communityId="g1" refreshKey="b" onListen={vi.fn()} />);
    expect(await screen.findByTestId('teaching-live')).toBeInTheDocument();
    answer = { items: [] };
    rerender(<TeachingLiveBanner communityId="g1" refreshKey="c" onListen={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('teaching-live')).toBeNull());
  });

  it('shows nothing, quietly, when the check fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'no' }, 500)));
    const { container } = render(<TeachingLiveBanner communityId="g1" onListen={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
