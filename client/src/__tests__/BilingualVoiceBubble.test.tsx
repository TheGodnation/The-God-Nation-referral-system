import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../i18n';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { ChatMessage } from '../components/chat/types';

// The central admin's voice message in two languages: both clips in one
// bubble, the reader's own language first, the other labelled; and the
// "live teaching" mark.
const noop = () => {};
const handlers = { mediaBase: '/api/communities/c1/conversation', showSender: true, highlighted: false, onReply: noop, onMenu: noop, onReact: noop, onJumpTo: noop, onOpenPhoto: noop };

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  senderName: 'Evangelist Stanley',
  isOwn: false,
  body: null,
  createdAt: new Date().toISOString(),
  deleted: false,
  attachments: [
    { id: 'a1', originalFilename: 'fr.webm', mimeType: 'audio/webm', byteSize: 10, language: 'fr' },
    { id: 'a2', originalFilename: 'en.webm', mimeType: 'audio/webm', byteSize: 10, language: 'en' },
  ],
  ...over,
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

function labels() {
  return screen.getAllByText(/🎧/).map((el) => el.textContent);
}

describe('Two-language voice message in the chat', () => {
  it('an English reader gets the English clip first and the French one labelled below it', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) })));
    render(<MessageBubble m={message({ liveTeaching: true })} {...handlers} />);
    expect(labels()).toEqual(['🎧 Listen in English', '🎧 Listen in French']);
    expect(screen.getByText(/Live teaching/)).toBeInTheDocument();
  });

  it('a French reader gets the French clip first', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) })));
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    render(<MessageBubble m={message()} {...handlers} />);
    expect(labels()).toEqual(['🎧 Écouter en français', '🎧 Écouter en anglais']);
    expect(screen.queryByText(/Enseignement en direct/)).not.toBeInTheDocument();
  });

  it('an ordinary voice note has no language labels', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) })));
    render(<MessageBubble m={message({ attachments: [{ id: 'a3', originalFilename: 'v.webm', mimeType: 'audio/webm', byteSize: 10 }] })} {...handlers} />);
    expect(screen.queryByText(/🎧/)).not.toBeInTheDocument();
  });
});
