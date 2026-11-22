import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatComposer } from '../components/chat/ChatComposer';
import { clearLinkPreviewCache } from '../components/LinkPreviewCard';

// The preview card while typing a message: it shows under the box, the x takes it off, and then the link is sent without a card.
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
const CARD = { url: 'https://news.example/a', title: 'A good story', description: 'The first lines of it.', image: null, site: 'news.example' };

beforeEach(() => {
  clearLinkPreviewCache();
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).includes('/api/member/link-preview') ? json({ preview: CARD }) : json({}))));
});
afterEach(() => vi.unstubAllGlobals());

const show = (onSend = vi.fn().mockResolvedValue(true)) => {
  render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} onPickMedia={vi.fn()} />);
  return onSend;
};
const type = (value: string) => fireEvent.change(screen.getByLabelText('Message'), { target: { value } });

describe('The preview card while typing', () => {
  it('shows the card under the box once the link is typed, and the message is sent as typed', async () => {
    const onSend = show();
    type('Read this https://news.example/a please');
    expect(await screen.findByTestId('link-preview-typing', {}, { timeout: 3000 })).toHaveTextContent('A good story');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].body).toBe('Read this https://news.example/a please');
  });

  it('with the x pressed the card goes, and the link is sent between < and >, so no card shows to the others', async () => {
    const onSend = show();
    type('Read this https://news.example/a please');
    await screen.findByTestId('link-preview-typing', {}, { timeout: 3000 });
    fireEvent.click(screen.getByTestId('link-preview-dismiss'));
    expect(screen.queryByTestId('link-preview-typing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0].body).toBe('Read this <https://news.example/a> please');
  });

  it('shows nothing for a message with no link', async () => {
    show();
    type('just words');
    await new Promise((r) => setTimeout(r, 800));
    expect(screen.queryByTestId('link-preview-typing')).toBeNull();
  });
});
