import { Fragment, type ReactNode } from 'react';

// What the writing box shows while you type, the way WhatsApp does: words in
// *stars* look bold, _underscores_ italic, ~tildes~ crossed out, with the
// symbols themselves left in faint grey. It follows the same rules as
// richText.tsx (a symbol only counts when it hugs the words and stays on its
// line). The text is not changed in any way — this only paints a copy behind
// the real box, so letters line up exactly (bold is drawn with a thin outline
// instead of a wider font, italics by leaning each word, so nothing moves).

const WORD = /[\p{L}\p{N}]/u;
const MARKS: Record<string, 'b' | 'i' | 's'> = { '*': 'b', _: 'i', '~': 's' };
const MAX_LIVE = 20000; // longer text is shown plain

interface Style {
  b?: boolean;
  i?: boolean;
  s?: boolean;
}

function styled(text: string, st: Style, key: string): ReactNode {
  if (!text) return null;
  const cls = [st.b ? 'lf-b' : '', st.s ? 'lf-s' : ''].filter(Boolean).join(' ');
  if (!st.i) return cls ? <span key={key} className={cls}>{text}</span> : <Fragment key={key}>{text}</Fragment>;
  // Italic: lean each word (spaces stay outside, so lines still wrap in the same places).
  return (
    <Fragment key={key}>
      {text.split(/(\s+)/).map((part, n) =>
        /^\s*$/.test(part) ? (
          <Fragment key={n}>{part}</Fragment>
        ) : (
          <span key={n} className={`lf-i ${cls}`}>
            {part}
          </span>
        ),
      )}
    </Fragment>
  );
}

function mark(ch: string, key: string) {
  return (
    <span key={key} className="lf-mark">
      {ch}
    </span>
  );
}

function inline(text: string, st: Style, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let n = 0;
  const flush = () => {
    if (buf) out.push(styled(buf, st, `${keyBase}t${n++}`));
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const kind = MARKS[ch];
    if (kind && !st[kind]) {
      const before = i === 0 ? '' : text[i - 1];
      const after = text[i + 1] ?? '';
      const opens = !WORD.test(before) && before !== ch && after !== '' && !/\s/.test(after) && after !== ch;
      if (opens) {
        let close = -1;
        for (let j = i + 2; j < text.length; j += 1) {
          if (text[j] === ch && !/\s/.test(text[j - 1]) && !WORD.test(text[j + 1] ?? '') && text[j + 1] !== ch) {
            close = j;
            break;
          }
        }
        if (close !== -1) {
          flush();
          out.push(mark(ch, `${keyBase}o${n++}`));
          out.push(...inline(text.slice(i + 1, close), { ...st, [kind]: true }, `${keyBase}${n++}`));
          out.push(mark(ch, `${keyBase}c${n++}`));
          i = close + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

const PREFIX = /^(\s*[-•]\s+|\s*\d{1,3}[.)]\s+|>\s?)/;
const HEADING = /^(#{1,3}\s+)/;

/** The painted copy of the text: same characters, with the formatting shown. */
export function renderLive(text: string): ReactNode {
  if (text.length > MAX_LIVE) return text;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, n) => {
        const nl = n < lines.length - 1 ? '\n' : '';
        const h = HEADING.exec(line);
        if (h) {
          return (
            <Fragment key={n}>
              <span className="lf-mark">{h[1]}</span>
              <span className="lf-h">{inline(line.slice(h[1].length), {}, `${n}h`)}</span>
              {nl}
            </Fragment>
          );
        }
        const p = PREFIX.exec(line);
        const quote = Boolean(p && p[1].startsWith('>'));
        return (
          <Fragment key={n}>
            {p && <span className="lf-mark">{p[1]}</span>}
            {quote ? <span className="lf-quote">{inline(line.slice(p![1].length), {}, `${n}q`)}</span> : inline(line.slice(p ? p[1].length : 0), {}, `${n}l`)}
            {nl}
          </Fragment>
        );
      })}
      {/* A last empty line needs height too. */}
      {'​'}
    </>
  );
}
