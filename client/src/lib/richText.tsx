import { Fragment, type ReactNode } from 'react';
import { LinkAnchor, splitLinks } from './linkify';

// WhatsApp-style text formatting, kept as plain text underneath:
//   *bold*  _italic_  ~strikethrough~
//   - bullet list   1. numbered list   > quote   # heading (posts only)
//   | a | b |  rows make a table (a "|---|---|" line under the first row marks it as the header)
// A marker only counts when it hugs the words (never "5 * 3 * 2") and is not
// in the middle of a word ("snake_case_name"). Web addresses are linked first
// and left alone, so an underscore inside a link never turns into italics.
// Everything is built as React elements, never as HTML, so a message can not
// inject anything into the page.

type Inline = { t: 'text'; v: string } | { t: 'link'; v: string; href: string } | { t: 'b' | 'i' | 's'; c: Inline[] };
type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'table'; header: Inline[][] | null; rows: Inline[][][] };

const MARKS: Record<string, 'b' | 'i' | 's'> = { '*': 'b', _: 'i', '~': 's' };
const WORD = /[\p{L}\p{N}]/u;
const MAX_FORMATTED = 20000; // longer than this is shown as it is

const LEFT = '';
const RIGHT = '';
const HOLD = new RegExp(`${LEFT}(\\d+)${RIGHT}`, 'g');

function parseMarks(text: string, links: { text: string; href: string }[]): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    // Put the links back where they were held.
    let last = 0;
    for (const m of buf.matchAll(HOLD)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ t: 'text', v: buf.slice(last, at) });
      const l = links[Number(m[1])];
      out.push({ t: 'link', v: l.text, href: l.href });
      last = at + m[0].length;
    }
    if (last < buf.length) out.push({ t: 'text', v: buf.slice(last) });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const kind = MARKS[ch];
    if (kind) {
      const before = i === 0 ? '' : text[i - 1];
      const after = text[i + 1] ?? '';
      const opens = !WORD.test(before) && before !== ch && after !== '' && !/\s/.test(after) && after !== ch;
      if (opens) {
        let j = i + 2;
        let close = -1;
        while (j < text.length) {
          if (text[j] === '\n') break; // a mark never spans lines
          if (text[j] === ch && !/\s/.test(text[j - 1]) && !WORD.test(text[j + 1] ?? '') && text[j + 1] !== ch) {
            close = j;
            break;
          }
          j += 1;
        }
        if (close > i + 1) {
          flush();
          out.push({ t: kind, c: parseMarks(text.slice(i + 1, close), links) });
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

function parseInline(text: string): Inline[] {
  if (text.length > MAX_FORMATTED) return splitLinks(text).map((p) => (p.href ? { t: 'link', v: p.text, href: p.href } : { t: 'text', v: p.text }));
  // Hold each web address out of the way while the marks are read.
  const links: { text: string; href: string }[] = [];
  let held = '';
  for (const p of splitLinks(text)) {
    if (p.href) {
      links.push({ text: p.text, href: p.href });
      held += `${LEFT}${links.length - 1}${RIGHT}`;
    } else held += p.text;
  }
  return parseMarks(held, links);
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** "| a | b |" as its cells ("\|" is a bar inside a cell). */
function tableCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i += 1;
    } else if (body[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

function parseBlocks(text: string, headings: boolean, splitOnBlank = false): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    while (para.length && !para[para.length - 1].trim()) para.pop();
    while (para.length && !para[0].trim()) para.shift();
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    let m: RegExpMatchArray | null;
    if (TABLE_ROW.test(line) && (TABLE_ROW.test(lines[n + 1] ?? '') || TABLE_ROW.test(lines[n - 1] ?? ''))) {
      // A run of "| … |" lines is a table; a rule line ("|---|---|") under the first row marks it as the header.
      endPara();
      let end = n;
      while (end + 1 < lines.length && TABLE_ROW.test(lines[end + 1])) end += 1;
      const rowsText = lines.slice(n, end + 1);
      const hasHeader = rowsText.length > 1 && TABLE_RULE.test(rowsText[1]) && tableCells(rowsText[1]).every((c) => /^:?-+:?$/.test(c));
      const body = rowsText.filter((_, k) => !(hasHeader && k === 1));
      const width = Math.max(...body.map((r) => tableCells(r).length));
      const cellsOf = (r: string) => {
        const c = tableCells(r).map((x) => parseInline(x));
        while (c.length < width) c.push([]);
        return c;
      };
      const parsed = body.map(cellsOf);
      blocks.push({ t: 'table', header: hasHeader ? parsed[0] : null, rows: hasHeader ? parsed.slice(1) : parsed });
      n = end;
    } else if ((m = line.match(BULLET)) && m[1].trim()) {
      endPara();
      const last = blocks[blocks.length - 1];
      const item = parseInline(m[1]);
      if (last && last.t === 'ul') last.items.push(item);
      else blocks.push({ t: 'ul', items: [item] });
    } else if ((m = line.match(NUMBER)) && m[1].trim()) {
      endPara();
      const last = blocks[blocks.length - 1];
      const item = parseInline(m[1]);
      if (last && last.t === 'ol') last.items.push(item);
      else blocks.push({ t: 'ol', items: [item] });
    } else if ((m = line.match(QUOTE))) {
      endPara();
      const last = blocks[blocks.length - 1];
      if (last && last.t === 'quote') last.c.push({ t: 'text', v: '\n' }, ...parseInline(m[1]));
      else blocks.push({ t: 'quote', c: parseInline(m[1]) });
    } else if (headings && (m = line.match(HEADING)) && m[2].trim()) {
      endPara();
      blocks.push({ t: 'h', level: m[1].length as 1 | 2 | 3, c: parseInline(m[2]) });
    } else if (splitOnBlank && !line.trim()) endPara();
    else para.push(line);
  }
  endPara();
  return blocks;
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === 'text') return <Fragment key={i}>{n.v}</Fragment>;
    if (n.t === 'link') return <LinkAnchor key={i} href={n.href}>{n.v}</LinkAnchor>;
    if (n.t === 'b') return <strong key={i}>{renderInline(n.c)}</strong>;
    if (n.t === 'i') return <em key={i}>{renderInline(n.c)}</em>;
    return <s key={i}>{renderInline(n.c)}</s>;
  });
}

const HEADING_CLASS = { 1: 'text-xl font-bold', 2: 'text-lg font-bold', 3: 'text-base font-semibold' } as const;

/** Message or post text with its formatting and web addresses shown. */
export function RichText({
  text,
  className = '',
  headings = false,
  comfort = false,
  'data-testid': testId,
}: {
  text: string | null | undefined;
  className?: string;
  headings?: boolean;
  /** Roomy spacing for long reading: clear gaps between paragraphs, extra room above each heading. */
  comfort?: boolean;
  'data-testid'?: string;
}) {
  if (!text) return null;
  const blocks = parseBlocks(text, headings, comfort);
  return (
    <div className={className} data-testid={testId}>
      {blocks.map((b, i) => {
        const gap = i === 0 ? '' : comfort ? (b.t === 'h' ? 'mt-7' : 'mt-4') : 'mt-1';
        if (b.t === 'p') return <p key={i} className={`whitespace-pre-wrap break-words ${gap}`}>{renderInline(b.c)}</p>;
        if (b.t === 'ul')
          return (
            <ul key={i} className={`list-disc space-y-0.5 pl-5 ${gap}`}>
              {b.items.map((it, k) => (
                <li key={k} className="whitespace-pre-wrap break-words">{renderInline(it)}</li>
              ))}
            </ul>
          );
        if (b.t === 'ol')
          return (
            <ol key={i} className={`list-decimal space-y-0.5 pl-5 ${gap}`}>
              {b.items.map((it, k) => (
                <li key={k} className="whitespace-pre-wrap break-words">{renderInline(it)}</li>
              ))}
            </ol>
          );
        if (b.t === 'quote')
          return (
            <blockquote key={i} className={`whitespace-pre-wrap break-words border-l-4 border-slate-300 pl-3 text-slate-600 ${gap}`}>
              {renderInline(b.c)}
            </blockquote>
          );
        if (b.t === 'table')
          return (
            <div key={i} data-testid="rich-table" className={`max-w-full overflow-x-auto ${gap}`} role="region" tabIndex={0}>
              <table className="w-full border-collapse whitespace-normal text-left text-[0.95em] leading-snug">
                {b.header && (
                  <thead>
                    <tr>
                      {b.header.map((c, k) => (
                        <th key={k} scope="col" className="min-w-[6rem] border border-slate-300 bg-slate-100 px-2.5 py-1.5 align-top font-semibold text-slate-900">{renderInline(c)}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {b.rows.map((r, k) => (
                    <tr key={k} className={k % 2 ? 'bg-slate-50' : ''}>
                      {r.map((c, x) => (
                        <td key={x} className="min-w-[6rem] break-words border border-slate-300 px-2.5 py-1.5 align-top">{renderInline(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (b.t !== 'h') return null;
        if (comfort) {
          // Sized in em so a heading always stays a little bigger than the text around it.
          return (
            <p key={i} className={`mb-[-0.6em] break-words font-bold text-brand-800 ${gap}`} style={{ fontSize: `${{ 1: 1.3, 2: 1.2, 3: 1.1 }[b.level]}em` }}>
              {renderInline(b.c)}
            </p>
          );
        }
        return <p key={i} className={`break-words ${HEADING_CLASS[b.level]} ${gap}`}>{renderInline(b.c)}</p>;
      })}
    </div>
  );
}

function plainInline(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'link' ? n.v : plainInline(n.c))).join('');
}

/** The text without its formatting symbols, on one line, for chat-list previews and quoted replies. */
export function plainPreview(text: string | null | undefined): string {
  if (!text) return '';
  return parseBlocks(text, true)
    .map((b) => {
      if (b.t === 'ul' || b.t === 'ol') return b.items.map(plainInline).join(' ');
      if (b.t === 'table') return [...(b.header ? [b.header] : []), ...b.rows].map((r) => r.map(plainInline).join(' ')).join(' ');
      return plainInline(b.c);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
