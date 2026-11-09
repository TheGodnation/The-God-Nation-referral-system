import { describe, expect, it } from 'vitest';
import { parseBookPage } from '../lib/bookPageParser';
import { BOOK1_PAGE } from './fixtures/book1Page';
import { BOOK2_PAGE } from './fixtures/book2Page';
import { BOOK3_PAGE } from './fixtures/book3Page';

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

describe('parseBookPage — Book Two as the founder sent it', () => {
  const page = parseBookPage(BOOK2_PAGE, 'The Doorway Into the Kingdom');

  it('finds the seven chapters, with "From the Author" as the first, labelled as written', () => {
    expect(page.chapters.map((c) => [c.label, c.title])).toEqual([
      ['From the Author', 'This Is Not Just Information. It Is a Summons.'],
      ['Introduction', 'Three Foundations. One Doorway.'],
      ['Chapter One', 'A World Operating Without Heaven'],
      ['Chapter Two', 'The Turn: Repentance'],
      ['Chapter Three', 'The Burial: Water Baptism'],
      ['Chapter Four', 'The Filling: The Holy Spirit'],
      ['Chapter Five', 'Through the Door: What Now?'],
    ]);
    expect(page.warnings).toEqual([]);
    expect(page.chapters[6].summary).toMatch(/how do I use it\?$/);
  });

  it('keeps the chapter-list title with the sentence under it', () => {
    expect(page.chaptersHeading).toBe('Inside the Book: Chapter by Chapter\nHere is what you will find as you move from outside the door to inside the Kingdom.');
  });

  it('writes the pitch: tagline and byline, big headline, a heading for the short slogan, the three steps as a list after their introduction', () => {
    const d = page.description;
    expect(d.startsWith('_Repent. Be Baptized. Receive the Spirit._\n\n_Book Two of the Kingdom Series_\n\n_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_')).toBe(true);
    expect(d).toContain('# There Is a Door. And You Were Made to Walk Through It.');
    expect(d).toContain('## Three Steps. One Door.\n\nHere is the doorway, and where this book takes you through each part of it:\n\n- Step One: Repentance, the Turn.');
    expect(d).toContain('## What Waits for You on the Other Side\n\nAs you walk through each step, this book will:\n\n- Show you why money');
    expect(d.match(/^- /gm)).toHaveLength(8);
    expect(d).not.toContain('Inside the Book');
  });

  it('writes the closing words: the list, the heading, paragraphs, and the two slogan lines in bold', () => {
    const c = page.closing;
    expect(c.startsWith('## This Book Is For You If...\n\n- You feel an emptiness')).toBe(true);
    expect(c.match(/^- /gm)).toHaveLength(5);
    expect(c).toContain('## Do Not Stay Outside Any Longer\n\nEvery strong house');
    expect(c).toContain('*The door is open. Walk through it today.*');
    expect(c).toContain('*Walk in it. Grow in it. Then help us bring others to it.*');
  });

  it('reads French author labels and keeps small words small', () => {
    const body = 'Un résumé assez long pour être un paragraphe complet et non un titre de section dans la page du livre.';
    const p = parseBookPage(`MOT DE L'AUTEUR Un titre\n${body}\nCHAPITRE UN Autre titre\n${body}`);
    expect(p.chapters.map((c) => c.label)).toEqual(["Mot de l'auteur", 'Chapitre Un']);
  });
});

describe('parseBookPage — Kingdom Keys, Volume 1 as the founder sent it', () => {
  const page = parseBookPage(BOOK3_PAGE, 'Kingdom Keys, Volume 1: The Foundation');

  it('finds "Foreword and Introduction" and the six chapters', () => {
    expect(page.chapters.map((c) => [c.label, c.title])).toEqual([
      ['Foreword and Introduction', 'The Problem Every Kingdom Citizen Must Solve'],
      ['Chapter One', 'You Are Already Rich. So Why Are You Still Poor?'],
      ['Chapter Two', 'The Finished Work and the Open Door'],
      ['Chapter Three', 'Rights Without Keys: The Tragedy of the Uninformed Heir'],
      ['Chapter Four', 'Understanding Kingdom Systems'],
      ['Chapter Five', 'What Are the Keys of the Kingdom?'],
      ['Chapter Six', 'The Key of the New Birth'],
    ]);
    expect(page.warnings).toEqual([]);
    expect(page.chaptersHeading).toBe('Inside the Book: Chapter by Chapter\nHere is how the book carries you from the gap in your life to the first key in your hand.');
  });

  it('keeps the headline as the headline (not as a tagline), the three gaps as a list with their closing sentence after it', () => {
    const d = page.description;
    expect(d.startsWith('_Unlocking the Rights of Kingdom Citizens for Visible Dominion on Earth_\n\n_Evangelist Stanley A. Ndoh | The God Nation Media & Leadership Academy_\n\n# You Already Own It. Now Learn How to Walk In It.')).toBe(true);
    expect(d).toContain('## Three Gaps. One Set of Keys.\n\nBefore you can close the gap');
    expect(d).toContain('- The gap of application: knowing the truth, but never putting it to work.\n\nFind which one is yours, and you will finally know what to do about it.');
    expect(d).toContain('## What You Will Walk Away With\n\n- A clear answer');
    expect(d.match(/^- /gm)).toHaveLength(8);
  });

  it('writes the closing words with the slogan in bold', () => {
    expect(page.closing).toContain('## The Keys Are Already in Your Hand\n\nEverything you need was settled at the Cross.');
    expect(page.closing).toContain('*The Kingdom is yours. The keys are in your hand. Now open the door.*');
    expect(page.closing.match(/^- /gm)).toHaveLength(5);
  });
});
