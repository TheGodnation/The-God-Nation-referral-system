import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  it('has no formatting bar until words are selected, and no "Aa" button', () => {
    composer();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Formatting' })).toBeNull();
    fireEvent.change(box(), { target: { value: 'Praise the Lord today' } });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('shows Bold, Italic and Strikethrough when words are selected, and makes them bold', async () => {
    composer();
    fireEvent.change(box(), { target: { value: 'Praise the Lord today' } });
    select(box(), 6, 15);
    const bar = await screen.findByTestId('selection-format-bar');
    for (const name of ['Bold', 'Italic', 'Strikethrough', 'More']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(within(bar).getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(box().value).toBe('Praise *the Lord* today'));
    // The words stay selected: tapping Bold again takes it off.
    await waitFor(() => expect([box().selectionStart, box().selectionEnd]).toEqual([8, 16]));
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(box().value).toBe('Praise the Lord today'));
  });

  it('italic and strikethrough work the same way', async () => {
    composer();
    fireEvent.change(box(), { target: { value: 'one two' } });
    select(box(), 0, 3);
    fireEvent.click(await screen.findByRole('button', { name: 'Italic' }));
    await waitFor(() => expect(box().value).toBe('_one_ two'));
  });

  it('the bar goes away when the selection is cleared', async () => {
    composer();
    fireEvent.change(box(), { target: { value: 'Praise the Lord' } });
    select(box(), 0, 6);
    expect(await screen.findByTestId('selection-format-bar')).toBeInTheDocument();
    select(box(), 3, 3);
    await waitFor(() => expect(screen.queryByTestId('selection-format-bar')).toBeNull());
  });

  it('"More" has bullets, numbers and quote for the selected lines', async () => {
    composer();
    fireEvent.change(box(), { target: { value: 'first' } });
    select(box(), 0, 5);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quote' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Heading' })).toBeNull(); // headings are for posts only
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
  it('shows a hint, and no bar, until words are selected', () => {
    render(<Post />);
    expect(screen.queryByTestId('selection-format-bar')).toBeNull();
    expect(screen.getByText('Select words to make them bold, italic or crossed out.')).toBeInTheDocument();
  });

  it('shows the Bold bar over the post when words are selected, and makes them bold', async () => {
    render(<Post />);
    const ta = screen.getByLabelText('Post') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Blessed are the peacemakers' } });
    select(ta, 12, 15);
    const bar = await screen.findByTestId('selection-format-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(ta.value).toBe('Blessed are *the* peacemakers'));
    expect(screen.queryByText('Select words to make them bold, italic or crossed out.')).toBeNull();
  });

  it('offers headings under "More" and applies them to the line', async () => {
    render(<Post />);
    const ta = screen.getByLabelText('Post') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Big news' } });
    select(ta, 0, 8);
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    await waitFor(() => expect(ta.value).toBe('# Big news'));
  });

  it('the bar goes away when the selection is cleared', async () => {
    render(<Post />);
    const ta = screen.getByLabelText('Post') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Praise the Lord' } });
    select(ta, 0, 6);
    expect(await screen.findByTestId('selection-format-bar')).toBeInTheDocument();
    select(ta, 3, 3);
    await waitFor(() => expect(screen.queryByTestId('selection-format-bar')).toBeNull());
  });
});

describe('formatting in the edit window', () => {
  it('shows the Bold bar when words are selected, like the message box', async () => {
    const { EditSheet } = await import('../components/chat/ChatActions');
    render(<EditSheet message={{ id: 'm1', body: 'Praise the Lord' } as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    const ta = screen.getByLabelText('Edit message', { selector: 'textarea' }) as HTMLTextAreaElement;
    expect(screen.queryByTestId('selection-format-bar')).toBeNull();
    select(ta, 7, 10);
    fireEvent.click(within(await screen.findByTestId('selection-format-bar')).getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(ta.value).toBe('Praise *the* Lord'));
  });
});
