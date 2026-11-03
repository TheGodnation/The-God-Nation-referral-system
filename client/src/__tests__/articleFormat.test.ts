import { describe, it, expect } from 'vitest';
import { applyFormat, wordStats } from '../lib/articleFormat';

// The toolbar of the article editor adds and removes the simple markers around the selection.
describe('Article formatting', () => {
  it('makes a heading of the line, takes it off again, and swaps heading levels', () => {
    const a = applyFormat('Intro\nGod is faithful\nEnd', 8, 8, 'h2');
    expect(a.text).toBe('Intro\n## God is faithful\nEnd');
    expect(applyFormat(a.text, a.start, a.end, 'h2').text).toBe('Intro\nGod is faithful\nEnd');
    expect(applyFormat(a.text, a.start, a.end, 'h3').text).toBe('Intro\n### God is faithful\nEnd');
  });

  it('turns several selected lines into a list or a numbered list, and back', () => {
    const t = 'one\ntwo\n\nthree';
    const ul = applyFormat(t, 0, t.length, 'ul');
    expect(ul.text).toBe('- one\n- two\n\n- three');
    expect(applyFormat(ul.text, ul.start, ul.end, 'ul').text).toBe(t);
    const ol = applyFormat(t, 0, t.length, 'ol');
    expect(ol.text).toBe('1. one\n2. two\n\n3. three');
    expect(applyFormat(ol.text, ol.start, ol.end, 'ol').text).toBe(t);
  });

  it('makes a quotation', () => {
    expect(applyFormat('Seek first the kingdom', 0, 4, 'quote').text).toBe('> Seek first the kingdom');
  });

  it('wraps the selection in bold or italic, unwraps it, and offers a placeholder when nothing is selected', () => {
    const b = applyFormat('say faith now', 4, 9, 'bold');
    expect(b.text).toBe('say **faith** now');
    expect(b.text.slice(b.start, b.end)).toBe('faith');
    expect(applyFormat(b.text, b.start, b.end, 'bold').text).toBe('say faith now');
    const i = applyFormat('say faith now', 4, 9, 'italic');
    expect(i.text).toBe('say *faith* now');
    const empty = applyFormat('x ', 2, 2, 'bold', undefined, 'bold text');
    expect(empty.text).toBe('x **bold text**');
    expect(empty.text.slice(empty.start, empty.end)).toBe('bold text');
  });

  it('does not mistake bold for italic when unwrapping', () => {
    const t = 'a **bold** b';
    const r = applyFormat(t, 4, 8, 'italic');
    expect(r.text).toBe('a ***bold*** b');
  });

  it('makes a link from the selection, and does nothing without an address', () => {
    const l = applyFormat('read the guide today', 9, 14, 'link', 'https://example.org/guide');
    expect(l.text).toBe('read the [guide](https://example.org/guide) today');
    expect(l.text.slice(l.start, l.end)).toBe('guide');
    expect(applyFormat('abc', 0, 3, 'link', '  ').text).toBe('abc');
  });

  it('counts words and reading time', () => {
    expect(wordStats('')).toEqual({ words: 0, minutes: 1 });
    expect(wordStats('word '.repeat(450))).toEqual({ words: 450, minutes: 3 });
  });
});
