import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberGroupChatPage } from '../pages/MemberGroupChatPage';
import { MemberChatsPage } from '../pages/MemberChatsPage';

// jsdom has no real media playback — mock the two methods
// TranslatedAudioPlayButton (and VoiceNotePlayer) call.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

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

const G = 'g1';
const now = new Date().toISOString();

const messages = [
  {
    id: 'm1',
    senderName: 'Ada Nkem',
    senderPhotoUrl: null,
    senderPersonId: 'p-ada',
    isOwn: false,
    body: 'Who is coming on Sunday?',
    createdAt: now,
    deleted: false,
    attachments: [],
    replyTo: null,
    reactions: [{ emoji: '🙏', count: 2, mine: true }],
  },
  {
    id: 'm2',
    senderName: 'Me Myself',
    isOwn: true,
    body: 'I am coming',
    createdAt: now,
    deleted: false,
    attachments: [],
    replyTo: { id: 'm1', senderName: 'Ada Nkem', body: 'Who is coming on Sunday?', deleted: false, attachmentMimeType: null },
    reactions: [],
  },
  {
    id: 'm3',
    senderName: 'Ben Tabe',
    isOwn: false,
    body: null,
    createdAt: now,
    deleted: false,
    attachments: [{ id: 'a1', originalFilename: 'voice-note.webm', mimeType: 'audio/webm', byteSize: 4000 }],
    replyTo: null,
    reactions: [],
  },
];

function baseRoutes(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
  return {
    'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
    [`GET /api/communities/${G}/conversation/messages`]: () => ({
      body: { items: messages, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
    }),
    [`GET /api/communities/${G}/conversation/messages/m3/attachments/a1/download-url`]: () => ({ body: { url: 'https://files.example/voice.webm' } }),
    ...extra,
  };
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/member/chats/group/${G}`]}>
      <Routes>
        <Route path="/member/chats/group/:communityId" element={<MemberGroupChatPage />} />
        <Route path="/member/chats" element={<p>Chats list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WhatsApp-style group chat', () => {
  it('shows bubbles with names, a reply quote, reactions and a voice note', async () => {
    mockFetch(baseRoutes());
    renderChat();
    expect(await screen.findByText('I am coming')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Buea Group' })).toBeInTheDocument();
    expect(screen.getAllByText('Ada Nkem').length).toBeGreaterThan(0);
    expect(screen.getByText('Ben Tabe')).toBeInTheDocument();
    // Reply quote inside my bubble shows the original text again.
    expect(screen.getAllByText('Who is coming on Sunday?')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '🙏 2' })).toHaveAttribute('aria-pressed', 'true');
    // The WhatsApp-style voice note: sender photo, play button, waveform —
    // backed by a hidden <audio> element once the signed URL resolves.
    await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute('src', 'https://files.example/voice.webm'));
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeInTheDocument();
    // Empty message box -> microphone button, like WhatsApp.
    expect(screen.getByRole('button', { name: /Tap to record a voice note/ })).toBeInTheDocument();
  });

  it('shows a translated message with the original one tap away', async () => {
    const translatedMessages = messages.map((m) =>
      m.id === 'm1' ? { ...m, translation: { sourceLanguage: 'fr' as const, translatedBody: 'Who is coming on Sunday? (EN)' } } : m,
    );
    mockFetch(
      baseRoutes({
        [`GET /api/communities/${G}/conversation/messages`]: () => ({
          body: { items: translatedMessages, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
        }),
      }),
    );
    renderChat();
    expect(await screen.findByText('Who is coming on Sunday? (EN)')).toBeInTheDocument();
    expect(screen.getByText('Translated from Français')).toBeInTheDocument();
    // "Who is coming on Sunday?" (untranslated) still appears once, in m2's
    // reply-quote preview of m1 — that preview always shows the real
    // original body, never a translation. The main bubble itself must not
    // also be showing it.
    expect(screen.getAllByText('Who is coming on Sunday?')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getAllByText('Who is coming on Sunday?')).toHaveLength(2);
    expect(screen.queryByText('Who is coming on Sunday? (EN)')).not.toBeInTheDocument();
  });

  it('shows a voice note\'s translated transcript, with the original transcript one tap away', async () => {
    const transcribedMessages = messages.map((m) =>
      m.id === 'm3'
        ? { ...m, transcript: { sourceLanguage: 'fr' as const, text: 'Please pray for the sick', translated: true, original: 'Priez pour les malades' } }
        : m,
    );
    mockFetch(
      baseRoutes({
        [`GET /api/communities/${G}/conversation/messages`]: () => ({
          body: { items: transcribedMessages, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
        }),
      }),
    );
    renderChat();
    expect(await screen.findByText('Transcript')).toBeInTheDocument();
    expect(screen.getByText('Please pray for the sick')).toBeInTheDocument();
    expect(screen.getByText('Translated from Français')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show original transcript' }));
    expect(screen.getByText('Priez pour les malades')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show translated transcript' })).toBeInTheDocument();
  });

  it('lets a viewer play the voice note\'s synthesized translated audio (voice-to-voice)', async () => {
    const transcribedMessages = messages.map((m) =>
      m.id === 'm3'
        ? {
            ...m,
            transcript: {
              sourceLanguage: 'fr' as const,
              text: 'Please pray for the sick',
              translated: true,
              original: 'Priez pour les malades',
              translatedAudioAvailable: true,
            },
          }
        : m,
    );
    mockFetch(
      baseRoutes({
        [`GET /api/communities/${G}/conversation/messages`]: () => ({
          body: { items: transcribedMessages, hasMore: false, unreadCount: 0, isAdministrator: false, canPost: true },
        }),
        [`GET /api/communities/${G}/conversation/messages/m3/translated-audio-url`]: () => ({
          body: { url: 'https://files.example/translated-voice.wav', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        }),
      }),
    );
    renderChat();
    const playButton = await screen.findByRole('button', { name: 'Listen in English' });
    fireEvent.click(playButton);

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages/m3/translated-audio-url'))).toBe(true));
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it('tapping a sender\'s name or photo in the chat opens their profile', async () => {
    mockFetch(baseRoutes());
    renderChat();
    await screen.findByText('I am coming');
    const nameLinks = screen.getAllByRole('link', { name: 'Ada Nkem' });
    for (const link of nameLinks) expect(link).toHaveAttribute('href', '/member/people/p-ada');
    // Ben Tabe's message has no senderPersonId in this fixture, so his name
    // stays plain text, never a broken/empty link.
    expect(screen.queryByRole('link', { name: 'Ben Tabe' })).not.toBeInTheDocument();
  });

  it('tapping my own reaction removes it', async () => {
    mockFetch(
      baseRoutes({
        [`DELETE /api/communities/${G}/conversation/messages/m1/reaction`]: () => ({ body: { reactions: [{ emoji: '🙏', count: 1, mine: false }] } }),
      }),
    );
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '🙏 2' }));
    expect(await screen.findByRole('button', { name: '🙏 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/m1/reaction'))).toBe(true);
  });

  it('react from the options sheet', async () => {
    mockFetch(
      baseRoutes({
        [`PUT /api/communities/${G}/conversation/messages/m2/reaction`]: () => ({ body: { reactions: [{ emoji: '❤️', count: 1, mine: true }] } }),
      }),
    );
    renderChat();
    await screen.findByText('I am coming');
    fireEvent.contextMenu(screen.getByText('I am coming'));
    const sheet = await screen.findByRole('dialog', { name: 'Message options' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'React with ❤️' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ emoji: '❤️' }));
    expect(await screen.findByRole('button', { name: '❤️ 1' })).toBeInTheDocument();
  });

  it('reply to a message, then send', async () => {
    mockFetch(
      baseRoutes({
        [`POST /api/communities/${G}/conversation/messages`]: () => ({ status: 201, body: { id: 'm4' } }),
      }),
    );
    renderChat();
    await screen.findByText('I am coming');
    fireEvent.contextMenu(screen.getAllByText('Who is coming on Sunday?')[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Message options' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Reply/ }));
    expect(screen.getByText('Replying to Ada Nkem')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Me too!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversation/messages'));
      expect(sent?.body).toEqual({ body: 'Me too!', replyToMessageId: 'm1' });
    });
    await waitFor(() => expect(screen.queryByText('Replying to Ada Nkem')).not.toBeInTheDocument());
  });

  it('says clearly when photos and voice notes are switched off', async () => {
    mockFetch(
      baseRoutes({
        [`POST /api/communities/${G}/attachments/authorize`]: () => ({ status: 503, body: { error: 'Attachments are not available right now.' } }),
      }),
    );
    renderChat();
    await screen.findByText('I am coming');
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('chat-gallery-input'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Photos, voice notes and videos can't be sent yet");
  });
});

describe('Chats list', () => {
  it('shows each group as a row that opens the chat, with the unread count', async () => {
    mockFetch({
      'GET /api/member/me/community-memberships': () => ({ body: { items: [{ communityId: G, communityName: 'Buea Group', status: 'ACTIVE' }] } }),
      [`GET /api/communities/${G}/conversation`]: () => ({ body: { unreadCount: 3 } }),
    });
    render(
      <MemoryRouter>
        <MemberChatsPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: /Buea Group/ });
    expect(link).toHaveAttribute('href', `/member/chats/group/${G}`);
    expect(await screen.findByLabelText('3 new messages')).toBeInTheDocument();
  });
});
