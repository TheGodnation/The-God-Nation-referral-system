// Reads a whole book page pasted by the central admin (the pitch, the list of
// chapters with a short summary each, and the words after them) and splits it
// into what the app stores: the description, the chapter-list title, the
// chapters (label + title + summary) and the closing words.
//
// The page is plain text copied from a Word file or a message, so there are no
// markers to rely on. It is read by the way such pages are laid out:
//   - a chapter starts on a line like "CHAPTER ONE  You Were Born to Rule",
//     "INTRODUCTION  Why Are We Still Not Free?", "CONCLUSION ...", "APPENDIX A ..."
//     (English or French), and its summary is the paragraph under it;
//   - a short line with no full stop at the end is a heading;
//   - a heading followed by several short lines is a bullet list;
//   - the first lines of the page (the title and the byline) come first, and the
//     line after them, when a long paragraph follows, is the big headline.
// The result is written with the app's own formatting symbols (see lib/richText):
// # big heading, ## heading, - bullet, *bold*, _italic_. The admin sees how it
// will look before saving, and can fix any line afterwards.

export interface ParsedChapter {
  label: string;
  title: string;
  summary: string;
}

export interface ParsedBookPage {
  description: string;
  chaptersHeading: string;
  chapters: ParsedChapter[];
  closing: string;
  warnings: string[];
}

const NUMBER_WORDS =
  'ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|' +
  'UN|UNE|DEUX|TROIS|QUATRE|CINQ|SEPT|HUIT|NEUF|DIX|ONZE|DOUZE|TREIZE|QUATORZE|QUINZE|SEIZE|DIX-SEPT|DIX-HUIT|DIX-NEUF|VINGT|\\d{1,2}|[IVXL]{1,6}';

const CHAPTER_LINE = new RegExp(
  '^(' +
    "(?:FOREWORD|PREFACE) AND INTRODUCTION|(?:AVANT-PROPOS|PRÉFACE) ET INTRODUCTION|" +
    'INTRODUCTION|PREFACE|PRÉFACE|FOREWORD|AVANT-PROPOS|PROLOGUE|CONCLUSION|EPILOGUE|ÉPILOGUE|AFTERWORD|POSTFACE|' +
    "FROM THE AUTHOR|THE AUTHOR['’]S WORD|AUTHOR['’]S WORD|MOT DE L['’]AUTEUR|DE L['’]AUTEUR|" +
    `(?:CHAPTER|CHAPITRE|PART|PARTIE)\\s+(?:${NUMBER_WORDS})|` +
    '(?:APPENDIX|ANNEXE|APPENDICE)(?:\\s+[A-Z0-9])?' +
    ')(?:\\s*[:.\\-–—|]\\s*|\\s+)(.+)$',
  'iu',
);

const MAX_CHAPTER_LINE = 140;

/** "CHAPTER ONE" → "Chapter One", "APPENDIX A" → "Appendix A", "CHAPTER IV" → "Chapter IV". */
function niceLabel(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      // Roman numerals, single letters and digits stay in capitals ("Chapter IV", "Appendix A").
      if (i > 0 && (/^[IVXL]{1,6}$/i.test(w) || /^[A-Za-z0-9]$/.test(w) || /^\d+$/.test(w))) return w.toUpperCase();
      // "From the Author", "Mot de l'auteur": the little words stay small.
      if (i > 0 && /^(the|of|and|de|du|des|et|la|le|les|l['’]\p{L}+)$/iu.test(w)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function clean(line: string): string {
  return line
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** A short line that does not end like a sentence: a heading. "…" and "?" endings count as headings. */
function headingLike(line: string): boolean {
  if (line.length > 60) return false;
  if (line.split(/\s+/).length > 9) return false;
  if (/(\.{3}|…)$/.test(line)) return true;
  // "Three Steps. One Door.": a very short slogan is a heading too.
  if (/\.$/.test(line) && line.length <= 32 && line.split(/\s+/).length <= 6) return true;
  return !/[.!,;:]$/.test(line);
}

function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return norm(a) === norm(b) && norm(a) !== '';
}

function stripBullet(line: string): string {
  return line.replace(/^[•▪◦·*–—-]\s+/, '');
}

/** Turns lines into the app's formatting: headings, bullet lists, paragraphs. */
function toMarkup(lines: string[], opts: { leading?: boolean; title?: string } = {}): string {
  const blocks: string[] = [];
  let i = 0;

  if (opts.leading) {
    // The title and byline lines at the very top.
    const top: string[] = [];
    // (a short tagline such as "Repent. Be Baptized. Receive the Spirit." belongs here too)
    while (i < lines.length && lines[i].length <= 100 && (!/[.!?]$/.test(lines[i]) || (i <= 3 && lines[i].length <= 50 && i + 1 < lines.length && lines[i + 1].length <= 100))) {
      top.push(lines[i]);
      i += 1;
    }
    if (top.length && opts.title && sameTitle(top[0], opts.title)) top.shift();
    for (const t of top) blocks.push(`_${t}_`);
    // The big headline: a short line followed by a long paragraph.
    if (i + 1 < lines.length && lines[i].length <= 100 && lines[i + 1].length > 100 && !headingLike(lines[i + 1])) {
      blocks.push(`# ${lines[i]}`);
      i += 1;
    }
  }

  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (heading !== null) blocks.push(`## ${heading}`);
    if (body.length) {
      const allShort = body.every((l) => l.length <= 220);
      const introduced = body.length >= 3 && /:$/.test(body[0]) && body.slice(1).every((l) => l.length <= 220);
      if (introduced) {
        blocks.push(stripBullet(body[0]));
        let items = body.slice(1);
        // "The gap of identity... / The gap of knowledge... / The gap of application... / Find which one is yours...":
        // when every item but the last starts with the same word and the last does not, the last is a closing sentence.
        const first = (l: string) => l.split(/\s+/)[0].toLowerCase();
        let closing: string | null = null;
        if (items.length >= 4 && items.slice(0, -2).every((l) => first(l) === first(items[0])) && first(items[items.length - 2]) === first(items[0]) && first(items[items.length - 1]) !== first(items[0])) {
          closing = items[items.length - 1];
          items = items.slice(0, -1);
        }
        blocks.push(items.map((l) => `- ${stripBullet(l)}`).join('\n'));
        if (closing) blocks.push(stripBullet(closing));
      } else if (allShort && body.length >= 2) {
        blocks.push(body.map((l) => `- ${stripBullet(l)}`).join('\n'));
      } else {
        const hasLong = body.some((l) => l.length > 70);
        for (const l of body) blocks.push(hasLong && l.length <= 70 ? `*${stripBullet(l)}*` : stripBullet(l));
      }
    }
    heading = null;
    body = [];
  };

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (headingLike(line)) {
      flush();
      heading = line;
    } else body.push(line);
  }
  flush();
  return blocks.join('\n\n');
}

export function parseBookPage(raw: string, bookTitle?: string): ParsedBookPage {
  const warnings: string[] = [];
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map(clean)
    .filter(Boolean);

  const heads: { at: number; label: string; title: string }[] = [];
  lines.forEach((line, at) => {
    if (line.length > MAX_CHAPTER_LINE) return;
    const m = line.match(CHAPTER_LINE);
    if (m) heads.push({ at, label: niceLabel(m[1]), title: m[2].trim() });
  });

  if (heads.length === 0) {
    warnings.push('NO_CHAPTERS');
    return { description: toMarkup(lines, { leading: true, title: bookTitle }), chaptersHeading: '', chapters: [], closing: '', warnings };
  }

  // Before the first chapter: the pitch, and (last line) the title of the chapter list.
  let pre = lines.slice(0, heads[0].at);
  let chaptersHeading = '';
  if (pre.length && headingLike(pre[pre.length - 1])) {
    chaptersHeading = pre[pre.length - 1];
    pre = pre.slice(0, -1);
  } else if (pre.length >= 2 && headingLike(pre[pre.length - 2]) && pre[pre.length - 1].length > 40) {
    // A heading with one sentence under it ("Inside the Book: Chapter by Chapter" / "Here is what you will find..."):
    // both go above the chapter list, the sentence on a second line.
    chaptersHeading = `${pre[pre.length - 2]}\n${pre[pre.length - 1]}`;
    pre = pre.slice(0, -2);
  }

  const chapters: ParsedChapter[] = [];
  let post: string[] = [];
  heads.forEach((h, n) => {
    const end = n + 1 < heads.length ? heads[n + 1].at : lines.length;
    let body = lines.slice(h.at + 1, end);
    if (n === heads.length - 1 && body.length > 1) {
      // The last chapter's summary is its first paragraph; a heading after it starts the closing words.
      const stop = body.findIndex((l, k) => k > 0 && headingLike(l));
      if (stop > 0) {
        post = body.slice(stop);
        body = body.slice(0, stop);
      }
    }
    chapters.push({ label: h.label, title: h.title, summary: body.join('\n') });
    if (!body.length) warnings.push(`NO_SUMMARY:${h.label}`);
    if (body.join('\n').length > 3000) warnings.push(`SUMMARY_TOO_LONG:${h.label}`);
  });

  const description = toMarkup(pre, { leading: true, title: bookTitle });
  const closing = toMarkup(post);
  if (description.length > 8000 || closing.length > 8000) warnings.push('TOO_LONG');
  return { description, chaptersHeading, chapters, closing, warnings };
}
