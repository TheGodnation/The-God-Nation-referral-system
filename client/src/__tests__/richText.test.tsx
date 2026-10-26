import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText, plainPreview } from '../lib/richText';
import { toggleInline, toggleLines } from '../lib/formatting';

const html = (text: string, headings = false) => render(<RichText text={text} headings={headings} />).container.innerHTML;

describe('RichText', () => {
  it('shows bold, italic and strikethrough, also together', () => {
    const h = html('*bold* and _italic_ and ~gone~ and *bold _both_ here*');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>italic</em>');
    expect(h).toContain('<s>gone</s>');
    expect(h).toContain('<strong>bold <em>both</em> here</strong>');
  });

  it('leaves ordinary text alone: spaces inside marks, maths, snake_case, lone marks', () => {
    for (const plain of ['5 * 3 * 2', 'use snake_case_name here', '* not bold *', 'a * b', 'tilde ~ alone', '**', 'cost is 2*3 or 4*5']) {
      expect(html(plain)).not.toMatch(/<(strong|em|s)>/);
    }
  });

  it('never lets a mark run across lines', () => {
    expect(html('*one\ntwo*')).not.toContain('<strong>');
  });

  it('makes bullet and numbered lists and quotes', () => {
    const h = html('Intro\n- first\n- second\n\n1. one\n2) two\n> wise words\n> more');
    expect(h).toContain('<ul');
    expect(h.match(/<li/g)).toHaveLength(4);
    expect(h).toContain('<ol');
    expect(h).toContain('<blockquote');
    expect(h).toContain('wise words\nmore');
  });

  it('shows headings only where they are allowed', () => {
    expect(html('# Big news', true)).toMatch(/<p class="break-words text-xl font-bold[^"]*">Big news<\/p>/);
    expect(html('# Big news', false)).toContain('# Big news');
  });

  it('keeps links tappable, even with underscores inside, and formatting around them', () => {
    render(<RichText text="*read https://example.com/a_b_c now*" />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://example.com/a_b_c');
    expect(a).toHaveTextContent('https://example.com/a_b_c');
    expect(a.closest('strong')).not.toBeNull();
    expect(a.closest('em')).toBeNull();
  });

  it('can not inject HTML', () => {
    const { container } = render(<RichText text={'<img src=x onerror=alert(1)> *hi* <script>1</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('gives a plain one-line preview without the symbols', () => {
    expect(plainPreview('*Dear* _all_,\n- item one\n- item two\n> quote')).toBe('Dear all, item one item two quote');
    expect(plainPreview('# Title\nbody ~x~')).toBe('Title body x');
    expect(plainPreview(null)).toBe('');
  });
});

describe('formatting buttons', () => {
  it('wraps the selection and keeps spaces outside the marks', () => {
    expect(toggleInline('say hello world', { start: 3, end: 9 }, '*')).toEqual({ text: 'say *hello* world', sel: { start: 5, end: 10 } });
  });
  it('takes the mark off again', () => {
    expect(toggleInline('say *hello* world', { start: 5, end: 10 }, '*').text).toBe('say hello world');
    expect(toggleInline('say *hello* world', { start: 4, end: 11 }, '*').text).toBe('say hello world');
  });
  it('puts a pair around the caret when nothing is selected', () => {
    expect(toggleInline('hi ', { start: 3, end: 3 }, '_')).toEqual({ text: 'hi __', sel: { start: 4, end: 4 } });
  });
  it('makes lists of the lines selected, numbering them, and undoes it', () => {
    const made = toggleLines('one\ntwo\nthree', { start: 0, end: 7 }, 'number');
    expect(made.text).toBe('1. one\n2. two\nthree');
    expect(toggleLines(made.text, made.sel, 'number').text).toBe('one\ntwo\nthree');
  });
  it('turns a bullet into a quote instead of stacking symbols', () => {
    expect(toggleLines('- note', { start: 0, end: 6 }, 'quote').text).toBe('> note');
  });
  it('works on the line the caret is on', () => {
    expect(toggleLines('a\nb\nc', { start: 2, end: 2 }, 'bullet').text).toBe('a\n- b\nc');
  });
});
