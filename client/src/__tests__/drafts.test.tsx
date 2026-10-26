import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatComposer } from '../components/chat/ChatComposer';
import { clearAllDrafts, loadDraft, pruneDrafts, saveDraft } from '../lib/drafts';

// Unsent text survives leaving the chat, like WhatsApp.

const composer = (draftKey: string, onSend = vi.fn().mockResolvedValue(true)) => (
  <ChatComposer key={draftKey} draftKey={draftKey} uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} onPickMedia={vi.fn()} />
);
const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('drafts', () => {
  it('brings back what was typed after leaving and returning to the chat', async () => {
    const first = render(composer('p1:group:g1'));
    fireEvent.change(box(), { target: { value: 'Dear brethren, tomorrow we' } });
    first.unmount(); // leaving the chat saves at once, without waiting
    expect(loadDraft('p1:group:g1')).toBe('Dear brethren, tomorrow we');

    render(composer('p1:group:g1'));
    expect(box().value).toBe('Dear brethren, tomorrow we');
  });

  it('keeps a separate draft for each chat', () => {
    const a = render(composer('p1:group:g1'));
    fireEvent.change(box(), { target: { value: 'for the HQ group' } });
    a.unmount();
    render(composer('p1:private:c9'));
    expect(box().value).toBe('');
  });

  it('removes the draft once the message is sent', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const first = render(composer('p1:group:g1', onSend));
    fireEvent.change(box(), { target: { value: 'Amen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    await waitFor(() => expect(box().value).toBe(''));
    first.unmount();
    expect(loadDraft('p1:group:g1')).toBe('');
  });

  it('keeps the draft if sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    const first = render(composer('p1:group:g1', onSend));
    fireEvent.change(box(), { target: { value: 'Not sent yet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    first.unmount();
    expect(loadDraft('p1:group:g1')).toBe('Not sent yet');
  });

  it('forgets a draft after 30 days, and erases every draft on sign-out', () => {
    vi.useFakeTimers();
    saveDraft('p1:group:g1', 'old words');
    saveDraft('p1:group:g2', 'newer words');
    vi.setSystemTime(Date.now() + 29 * 24 * 3600 * 1000);
    expect(loadDraft('p1:group:g1')).toBe('old words');
    vi.setSystemTime(Date.now() + 2 * 24 * 3600 * 1000);
    expect(loadDraft('p1:group:g1')).toBe('');
    saveDraft('p1:group:g3', 'fresh');
    pruneDrafts();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('draft:v1:'))).toEqual(['draft:v1:p1:group:g3']);
    clearAllDrafts();
    expect(loadDraft('p1:group:g3')).toBe('');
  });

  it('does not keep a draft of only spaces', () => {
    saveDraft('p1:group:g1', 'hello');
    saveDraft('p1:group:g1', '   ');
    expect(loadDraft('p1:group:g1')).toBe('');
  });
});
