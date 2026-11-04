import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { htmlToMarkup, plainToMarkup, smartPaste } from '../lib/pasteHtml';
import { RichText } from '../lib/richText';
import { FormattedTextarea } from '../components/FormattedTextarea';

describe('copied text keeps its shape', () => {
  it('turns headings, bold, italics, lists and quotes into the app’s format', () => {
    const md = htmlToMarkup(
      '<h1>Walking in Love</h1><p>Love is <b>patient</b> and <i>kind</i>.</p><h3>Key verses</h3><ul><li>1 John 4:8</li><li>John 13:34</li></ul><ol><li>First</li><li>Second</li></ol><blockquote>God is love.</blockquote>',
    );
    expect(md).toBe('## Walking in Love\n\nLove is *patient* and _kind_.\n\n### Key verses\n\n- 1 John 4:8\n- John 13:34\n\n1. First\n2. Second\n\n> God is love.');
  });

  it('makes a short all-bold line a heading (Word and Google Docs send headings that way)', () => {
    const md = htmlToMarkup(
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700">The Power of Prayer</span></p><p><span style="font-weight:400">Prayer is talking with God every day, and listening.</span></p><p><span style="font-weight:700">This whole long sentence is bold but it ends like a sentence, so it stays a paragraph.</span></p></b>',
    );
    expect(md).toBe('## The Power of Prayer\n\nPrayer is talking with God every day, and listening.\n\n*This whole long sentence is bold but it ends like a sentence, so it stays a paragraph.*');
  });

  it('keeps a table in order, with its header row and empty cells', () => {
    const md = htmlToMarkup(
      '<table><thead><tr><th>Day</th><th>Topic</th><th>Verse</th></tr></thead><tbody><tr><td>Monday</td><td>Faith</td><td>Heb 11:1</td></tr><tr><td>Tuesday</td><td colspan="2">Hope | joy</td></tr></tbody></table>',
    );
    expect(md).toBe('| Day | Topic | Verse |\n| --- | --- | --- |\n| Monday | Faith | Heb 11:1 |\n| Tuesday | Hope \\| joy |  |');
  });

  it('handles a cell that spans several rows without shifting the columns', () => {
    const md = htmlToMarkup('<table><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">x</td><td>1</td></tr><tr><td>2</td></tr></table>');
    expect(md).toBe('| A | B |\n| --- | --- |\n| x | 1 |\n|  | 2 |');
  });

  it('turns a Word-style bullet paragraph into a list item and ignores scripts and styles', () => {
    const md = htmlToMarkup('<style>p{color:red}</style><script>alert(1)</script><p>Intro</p><p>·&nbsp;One</p><p>·&nbsp;Two</p>');
    expect(md).toBe('Intro\n\n- One\n- Two');
    expect(md).not.toMatch(/alert|color/);
  });

  it('keeps lines that come as separate divs, and an empty div as a blank line', () => {
    expect(htmlToMarkup('<div>Line one</div><div>Line two</div><div><br></div><div>Next</div>')).toBe('Line one\nLine two\n\nNext');
  });

  it('plain text: tabs become a table, bullets become list lines, title-like lines become headings', () => {
    const md = plainToMarkup('Day\tTopic\nMonday\tFaith\nTuesday\tHope\n\nHOW TO PRAY\nStart by thanking God for who He is and what He has done in your life.\n\n• First\n• Second');
    expect(md).toBe('| Day | Topic |\n| Monday | Faith |\n| Tuesday | Hope |\n\n## HOW TO PRAY\nStart by thanking God for who He is and what He has done in your life.\n\n- First\n- Second');
    expect(plainToMarkup('Lesson 2\n\nSome words here that make a proper paragraph of the lesson text.')).toBe('## Lesson 2\n\nSome words here that make a proper paragraph of the lesson text.');
    expect(plainToMarkup('Faith\nIt is the substance of things hoped for, the evidence of things not seen.')).toBe('### Faith\nIt is the substance of things hoped for, the evidence of things not seen.');
  });

  it('leaves ordinary sentences and already-formatted lines alone', () => {
    expect(plainToMarkup('Just a sentence.')).toBe('Just a sentence.');
    expect(plainToMarkup('## Mine\n- a\n1. b\n> c')).toBe('## Mine\n- a\n1. b\n> c');
    expect(smartPaste({ html: '', plain: 'one plain line' })).toBeNull();
  });
});

describe('a table in a teaching', () => {
  it('shows in order, with a header, and never as a jumble of lines', () => {
    render(<RichText headings comfort text={'Before\n\n| Day | Topic |\n| --- | --- |\n| Monday | **x** Faith |\n| Tuesday | Hope |\n\nAfter'} />);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Day', 'Topic']);
    expect(within(rows[2]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Tuesday', 'Hope']);
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('a single line with bars is only text, and a table without a rule line has no header', () => {
    const { container } = render(<RichText text={'a | b | c'} />);
    expect(container.querySelector('table')).toBeNull();
    render(<RichText text={'| a | b |\n| c | d |'} />);
    expect(screen.getAllByRole('table').at(-1)!.querySelector('th')).toBeNull();
  });
});

function Box({ headings = true, maxLength }: { headings?: boolean; maxLength?: number }) {
  const [v, setV] = useState('');
  return <FormattedTextarea aria-label="Text" headings={headings} maxLength={maxLength} value={v} onValueChange={setV} />;
}
const paste = (el: HTMLElement, data: Record<string, string>) =>
  fireEvent.paste(el, { clipboardData: { getData: (k: string) => data[k] ?? '' } });

describe('pasting into the writing box', () => {
  beforeEach(() => localStorage.clear());

  it('keeps headings and tables, and "Paste as plain text" puts back what was copied', () => {
    render(<Box />);
    const box = screen.getByLabelText('Text') as HTMLTextAreaElement;
    paste(box, { 'text/html': '<h2>Faith</h2><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>', 'text/plain': 'Faith\nA\tB\n1\t2' });
    expect(box.value).toBe('## Faith\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(screen.getByTestId('paste-note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Paste as plain text' }));
    expect(box.value).toBe('Faith\nA\tB\n1\t2');
    expect(screen.queryByTestId('paste-note')).toBeNull();
  });

  it('starts a table on its own line when pasted after words', () => {
    render(<Box />);
    const box = screen.getByLabelText('Text') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Look: ' } });
    box.setSelectionRange(6, 6);
    paste(box, { 'text/plain': 'A\tB\n1\t2' });
    expect(box.value).toBe('Look: \n| A | B |\n| 1 | 2 |');
  });

  it('lets an ordinary one-line paste happen as usual, and does nothing special in chat-style boxes', () => {
    render(<Box />);
    const box = screen.getByLabelText('Text');
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    ev.clipboardData = { getData: (k: string) => (k === 'text/plain' ? 'hello' : '') };
    box.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('the formatting bar on a phone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sits above the keyboard in big, well-spaced buttons, away from the phone’s own menu', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    render(<Box />);
    const box = screen.getByLabelText('Text') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'A heading line' } });
    box.setSelectionRange(0, 9);
    fireEvent.select(box);
    const bar = screen.getByTestId('selection-format-bar');
    expect(bar).toHaveAttribute('data-placement', 'keyboard');
    // Lifted out of the page, to the bottom of the screen.
    expect(bar.closest('.fixed')?.parentElement).toBe(document.body);
    expect(within(bar).getByRole('button', { name: 'Bold' }).className).toContain('h-12');
    expect(bar.className).toContain('gap-3');
    fireEvent.click(within(bar).getByRole('button', { name: 'Bold' }));
    expect(box.value).toBe('*A heading* line');
  });
});

describe('a table whose first row is bold', () => {
  it('uses that row as the header, without the stars', () => {
    expect(htmlToMarkup('<table><tr><td><p><span style="font-weight:700">Archangel</span></p></td><td><p><b>Role</b></p></td></tr><tr><td>Michael</td><td>Warrior</td></tr></table>')).toBe('| Archangel | Role |\n| --- | --- |\n| Michael | Warrior |');
  });
});

describe('a table copied as plain text with spaces (no tabs)', () => {
  it('becomes a table, and the line after it can be a heading', () => {
    const md = plainToMarkup(
      'Generation Start End\n17th Generation 131,072 262,143\n18th Generation 262,144 524,287\n19th Generation 524,288 1,048,575\n20th Generation 1,048,576 2,097,151\nWhat this means for The God Nation\nEvery believer who wins one soul adds to a chain that never stops growing, generation after generation.',
    );
    expect(md).toBe(
      '| Generation | Start | End |\n| --- | --- | --- |\n| 17th Generation | 131,072 | 262,143 |\n| 18th Generation | 262,144 | 524,287 |\n| 19th Generation | 524,288 | 1,048,575 |\n| 20th Generation | 1,048,576 | 2,097,151 |\n\n### What this means for The God Nation\nEvery believer who wins one soul adds to a chain that never stops growing, generation after generation.',
    );
  });

  it('without a header line still makes the table; two lines or sentences with numbers are left alone', () => {
    expect(plainToMarkup('18th Generation 262,144 524,287\n19th Generation 524,288 1,048,575\n20th Generation 1,048,576 2,097,151')).toBe(
      '| 18th Generation | 262,144 | 524,287 |\n| 19th Generation | 524,288 | 1,048,575 |\n| 20th Generation | 1,048,576 | 2,097,151 |',
    );
    expect(plainToMarkup('18th Generation 262,144 524,287\n19th Generation 524,288 1,048,575')).not.toContain('|');
    expect(plainToMarkup('We met 3 times in 2020 and 2021 again.')).not.toContain('|');
  });
});
