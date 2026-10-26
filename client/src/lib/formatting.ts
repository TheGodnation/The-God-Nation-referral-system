// The editing side of text formatting: what the Bold / Italic / list buttons
// do to the text in the box. See richText.tsx for how the symbols are shown.

export interface Selection {
  start: number;
  end: number;
}
export interface Edit {
  text: string;
  sel: Selection;
}
export type InlineMark = '*' | '_' | '~';
export type LineKind = 'bullet' | 'number' | 'quote' | 'heading';

/** Wraps the selection in a mark, or takes the mark off if it is already there. With nothing selected, puts a pair around the caret. */
export function toggleInline(text: string, sel: Selection, mark: InlineMark): Edit {
  let { start, end } = sel;
  if (start === end) {
    return { text: text.slice(0, start) + mark + mark + text.slice(end), sel: { start: start + 1, end: start + 1 } };
  }
  // Spaces at the edges stay outside the marks, as the marks must hug the words.
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (start === end) return { text, sel };
  if (text[start - 1] === mark && text[end] === mark) {
    return { text: text.slice(0, start - 1) + text.slice(start, end) + text.slice(end + 1), sel: { start: start - 1, end: end - 1 } };
  }
  const inner = text.slice(start, end);
  if (inner.length > 1 && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(1, -1);
    return { text: text.slice(0, start) + bare + text.slice(end), sel: { start, end: start + bare.length } };
  }
  return { text: text.slice(0, start) + mark + inner + mark + text.slice(end), sel: { start: start + 1, end: end + 1 } };
}

const ANY_PREFIX = /^(\s*[-*•]\s+|\s*\d{1,3}[.)]\s+|>\s?|#{1,3}\s+)/;
const HAS: Record<LineKind, RegExp> = {
  bullet: /^\s*[-•]\s+/,
  number: /^\s*\d{1,3}[.)]\s+/,
  quote: /^>\s?/,
  heading: /^#{1,3}\s+/,
};

/** Turns the lines in the selection into a list / quote / heading, or back into plain lines if they already are one. */
export function toggleLines(text: string, sel: Selection, kind: LineKind): Edit {
  const from = text.lastIndexOf('\n', Math.max(sel.start - 1, 0)) + 1;
  const stop = sel.end > sel.start && text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end;
  const nl = text.indexOf('\n', stop);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split('\n');
  const filled = lines.filter((l) => l.trim());
  const allHave = filled.length > 0 && filled.every((l) => HAS[kind].test(l));
  let counter = 0;
  const changed = lines.map((l) => {
    if (!l.trim()) return l;
    const bare = l.replace(ANY_PREFIX, '');
    if (allHave) return bare;
    counter += 1;
    if (kind === 'bullet') return `- ${bare}`;
    if (kind === 'number') return `${counter}. ${bare}`;
    if (kind === 'quote') return `> ${bare}`;
    return `# ${bare}`;
  });
  const joined = changed.join('\n');
  return { text: text.slice(0, from) + joined + text.slice(to), sel: { start: from, end: from + joined.length } };
}
