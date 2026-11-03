// Formatting helpers for the Knowledge Centre article editor. The article text uses a few simple
// markers (see server/src/lib/publicSite/text.ts): ## heading, ### smaller heading, - list,
// 1. numbered list, > quotation, **bold**, *italic*, [words](address). These functions add or
// remove those markers around the writer's selection, so nobody has to type them by hand.

export type Fmt = 'h2' | 'h3' | 'bold' | 'italic' | 'ul' | 'ol' | 'quote' | 'link';
export interface Edit { text: string; start: number; end: number }

const LINE_PREFIX: Record<'h2' | 'h3' | 'ul' | 'quote', string> = { h2: '## ', h3: '### ', ul: '- ', quote: '> ' };
const ANY_PREFIX = /^(#{2,3} |- |> |\d+\. )/;

function lineEdit(text: string, start: number, end: number, kind: 'h2' | 'h3' | 'ul' | 'ol' | 'quote'): Edit {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nl = text.indexOf('\n', end);
  const lineEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const marked = (l: string) => (kind === 'ol' ? /^\d+\. /.test(l) : l.startsWith(LINE_PREFIX[kind]));
  const content = lines.filter((l) => l.trim() !== '');
  const allMarked = content.length > 0 && content.every(marked);
  let n = 0;
  const out = lines.map((l) => {
    if (l.trim() === '') return l;
    const bare = allMarked ? l.replace(kind === 'ol' ? /^\d+\. / : LINE_PREFIX[kind], '') : l.replace(ANY_PREFIX, '');
    if (allMarked) return bare;
    n += 1;
    return (kind === 'ol' ? `${n}. ` : LINE_PREFIX[kind]) + bare;
  });
  const block = out.join('\n');
  return { text: text.slice(0, lineStart) + block + text.slice(lineEnd), start: lineStart, end: lineStart + block.length };
}

function wrapEdit(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const sel = text.slice(start, end);
  // Already wrapped just outside the selection: take the markers off.
  if (sel && text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark && !(mark === '*' && text[start - 2] === '*')) {
    return { text: text.slice(0, start - mark.length) + sel + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  const inner = sel || placeholder;
  const next = text.slice(0, start) + mark + inner + mark + text.slice(end);
  return { text: next, start: start + mark.length, end: start + mark.length + inner.length };
}

export function applyFormat(text: string, start: number, end: number, kind: Fmt, url?: string, placeholder = 'text'): Edit {
  switch (kind) {
    case 'h2':
    case 'h3':
    case 'ul':
    case 'ol':
    case 'quote':
      return lineEdit(text, start, end, kind);
    case 'bold':
      return wrapEdit(text, start, end, '**', placeholder);
    case 'italic':
      return wrapEdit(text, start, end, '*', placeholder);
    case 'link': {
      const label = text.slice(start, end) || placeholder;
      const address = (url ?? '').trim();
      if (!address) return { text, start, end };
      const piece = `[${label}](${address})`;
      return { text: text.slice(0, start) + piece + text.slice(end), start: start + 1, end: start + 1 + label.length };
    }
  }
}

/** Words in the text, and the reading time (about 200 words a minute, never less than one). */
export function wordStats(text: string): { words: number; minutes: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.ceil(words / 200)) };
}
