import { describe, expect, it } from 'vitest';
import { parseBookPage } from '../lib/bookPageParser';
import { BOOK1_PAGE } from './fixtures/book1Page';

describe('parseBookPage — Book One as the founder sent it', () => {
  const page = parseBookPage(BOOK1_PAGE, 'The Restoration of Dominion');

  it('finds the eight chapters with their labels and titles, in order', () => {
    expect(page.chapters.map((c) => [c.label, c.title])).toEqual([
      ['Introduction', 'Why Are We Still Not Free?'],
      ['Chapter One', 'You Were Born to Rule, Not to Struggle'],
      ['Chapter Two', 'The Day Everything Was Stolen'],
      ['Chapter Three', 'A Kingdom Bigger Than Any Problem You Face'],
      ['Chapter Four', "You Carry Heaven's Power Wherever You Go"],
      ['Chapter Five', 'The Door Is Open. Walk In.'],
      ['Conclusion', 'You Were Made for This'],
      ['Appendix A', 'Your Quick-Reference Guide'],
    ]);
    expect(page.warnings).toEqual([]);
  });

  it('gives each chapter its own summary, and the last one only its first paragraph', () => {
    expect(page.chapters[0].summary).toMatch(/^You work hard\./);
    expect(page.chapters[0].summary).toMatch(/about to find out what it is\.$/);
    expect(page.chapters[5].summary).toMatch(/what changes the moment you pray it\.$/);
    expect(page.chapters[7].summary).toMatch(/^A simple glossary of the key words/);
    expect(page.chapters[7].summary).toMatch(/what you have learned\.$/);
    expect(page.chapters[7].summary).not.toMatch(/This Book Is For You/);
  });

  it('keeps the chapter-list title and drops the book title line', () => {
    expect(page.chaptersHeading).toBe('Chapter by Chapter: Your Journey to Dominion');
    expect(page.description).not.toMatch(/THE RESTORATION OF DOMINION/);
  });

  it('writes the pitch with byline, big headline, paragraphs and a bullet list', () => {
    const d = page.description;
    expect(d.startsWith('_Book One of the Kingdom Series_\n\n_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_')).toBe(true);
    expect(d).toContain('# Stop Being Pushed Around by Life. Start Ruling Over It.');
    expect(d).toContain('\n\nAre you tired of stress');
    expect(d).toContain('## What This Book Will Do For You\n\n- Show you the real reason');
    expect(d.match(/^- /gm)).toHaveLength(5);
    expect(d).not.toContain('Chapter by Chapter');
  });

  it('writes the closing words: a bullet list, a heading, paragraphs and the slogan lines in bold', () => {
    const c = page.closing;
    expect(c.startsWith('## This Book Is For You If...\n\n- You feel stressed')).toBe(true);
    expect(c.match(/^- /gm)).toHaveLength(5);
    expect(c).toContain('## Why Read It Now?\n\nBecause every day you wait');
    expect(c).toContain('*Your restoration begins on page one.*');
    expect(c).toContain('*Read it. Rise in it. Then help us carry it to the world.*');
    expect(c).toContain('\n\nGet your copy of The Restoration of Dominion today.');
  });
});

describe('parseBookPage — other layouts', () => {
  it('reads French labels and single-space separators', () => {
    const p = parseBookPage(
      ['INTRODUCTION Pourquoi ne sommes-nous pas libres ?', 'Un résumé assez long pour être un paragraphe complet et non un titre de section dans la page du livre.', 'CHAPITRE UN Né pour régner', 'Un autre résumé assez long pour être un paragraphe complet et non un titre de section dans la page.', 'ANNEXE A Guide rapide', 'Un dernier résumé assez long pour être un paragraphe complet et non un titre de section dans la page.'].join('\n'),
    );
    expect(p.chapters.map((c) => [c.label, c.title])).toEqual([
      ['Introduction', 'Pourquoi ne sommes-nous pas libres ?'],
      ['Chapitre Un', 'Né pour régner'],
      ['Annexe A', 'Guide rapide'],
    ]);
  });

  it('keeps Roman numerals in capitals and reads digits', () => {
    const body = 'Un résumé assez long pour être un paragraphe complet et non un titre de section dans la page du livre.';
    const p = parseBookPage(`CHAPTER IV Four\n${body}\nCHAPTER 5 Five\n${body}`);
    expect(p.chapters.map((c) => c.label)).toEqual(['Chapter IV', 'Chapter 5']);
  });

  it('puts everything in the description, with a warning, when there are no chapter lines', () => {
    const p = parseBookPage('A heading\nJust one long paragraph of words that goes on and on and on and on and on and on and on and on.');
    expect(p.chapters).toEqual([]);
    expect(p.warnings).toContain('NO_CHAPTERS');
    expect(p.description).toContain('A heading');
  });

  it('warns about a chapter with no summary', () => {
    const p = parseBookPage('CHAPTER ONE First\nCHAPTER TWO Second\nA summary that is long enough to be a paragraph and not a heading of any kind at all.');
    expect(p.warnings).toContain('NO_SUMMARY:Chapter One');
  });

  it('does not mistake a long summary sentence starting with "Introduction" for a chapter', () => {
    const p = parseBookPage(
      'CHAPTER ONE First\nIntroduction to the idea of rule: this long sentence is a summary paragraph that goes well past the length of any heading line and carries on for quite a while longer than that.',
    );
    expect(p.chapters).toHaveLength(1);
    expect(p.chapters[0].summary).toMatch(/^Introduction to the idea/);
  });
});
