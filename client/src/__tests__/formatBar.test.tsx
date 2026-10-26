import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ChatComposer } from '../components/chat/ChatComposer';
import { FormattedTextarea } from '../components/FormattedTextarea';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) })));
});
afterEach(() => vi.unstubAllGlobals());

const composer = (onSend = vi.fn().mockResolvedValue(true)) =>
  render(<ChatComposer uploadPath="/api/communities/g1/conversation/attachments" replyTo={null} onCancelReply={vi.fn()} onSend={onSend} onPickMedia={vi.fn()} />);
const box = () => screen.getByLabelText('Message') as HTMLTextAreaElement;

function select(el: HTMLTextAreaElement, start: number, end: number) {
  el.focus();
  el.setSelectionRange(start, end);
  fireEvent.select(el);
}

describe('formatting in the message box', () => {
  it('has the buttons hidden until Aa is tapped', () => {
    composer();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument();
    for (const name of ['Bold', 'Italic', 'Strikethrough', 'Bullet list', 'Numbered list', 'Quote']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Heading' })).toBeNull(); // headings are for posts only
  });

  it('opens by itself when words are selected, and makes them bold', async () => {
    composer();
    fireEvent.change(box(), { target: { value: 'Praise the Lord today' } });
    select(box(), 6, 15);
    expect(await screen.findByRole('toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(box().value).toBe('Praise *the Lord* today'));
  });

  it('makes a bullet list of the line being written', async () => {
    composer();
    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    fireEvent.change(box(), { target: { value: 'first' } });
    select(box(), 5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    await waitFor(() => expect(box().value).toBe('- first'));
  });

  it('sends the symbols as written, so the chat can show them formatted', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    composer(onSend);
    fireEvent.change(box(), { target: { value: 'Be *blessed*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: 'Be *blessed*' })));
  });
});

describe('formatting in posts', () => {
  function Post() {
    const [v, setV] = useState('');
    return <FormattedTextarea aria-label="Post" headings value={v} onValueChange={setV} />;
  }
  it('offers headings and applies them to the line', async () => {
    render(<Post />);
    const ta = screen.getByLabelText('Post') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Big news' } });
    select(ta, 0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    await waitFor(() => expect(ta.value).toBe('# Big news'));
  });
});
