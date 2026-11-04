// Turns what a person copies (from Word, Google Docs, a web page, a spreadsheet, or plain text)
// into the app's own plain-text format described in lib/richText.tsx, so a teaching keeps its
// shape when pasted:
//   headings  -> "## Heading"        bold / italic / strike -> *bold* _italic_ ~strike~
//   lists     -> "- item" / "1. item"   quotes -> "> quote"
//   tables    -> "| a | b |" rows (first row is the header when a "|---|---|" line follows it)
// Nothing here touches the page: it only reads the pasted HTML in a detached document and
// returns text. The result is ordinary text the person can still edit by hand.

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'noscript', 'template', 'svg', 'img', 'iframe', 'object', 'embed', 'button', 'input', 'select', 'textarea']);
const MAX_HEADING_CHARS = 90;

type El = Element & { style?: CSSStyleDeclaration };

function styleOf(el: Element, prop: 'fontWeight' | 'fontStyle' | 'textDecoration' | 'whiteSpace' | 'display'): string {
  return ((el as El).style?.[prop] ?? '').toString().toLowerCase();
}

function isBoldEl(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const w = styleOf(el, 'fontWeight');
  if (w) {
    if (w === 'normal' || w === 'lighter') return false;
    if (w === 'bold' || w === 'bolder') return true;
    const n = Number(w);
    if (Number.isFinite(n)) return n >= 600;
  }
  return tag === 'b' || tag === 'strong' || tag === 'th';
}
function isItalicEl(el: Element): boolean {
  const s = styleOf(el, 'fontStyle');
  if (s) return s === 'italic' || s === 'oblique';
  const tag = el.tagName.toLowerCase();
  return tag === 'i' || tag === 'em' || tag === 'cite';
}
function isStrikeEl(el: Element): boolean {
  const d = styleOf(el, 'textDecoration');
  if (d.includes('line-through')) return true;
  const tag = el.tagName.toLowerCase();
  return tag === 's' || tag === 'strike' || tag === 'del';
}

/** Wrap text in a mark so the symbol hugs the words (the rule the reader needs), and never spans lines. */
function wrap(text: string, mark: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line)!;
      if (!m[2]) return line;
      // Already wrapped in this very mark: leave it.
      if (m[2].length > 1 && m[2].startsWith(mark) && m[2].endsWith(mark)) return line;
      return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
    })
    .join('\n');
}

/** Word marks inside a heading are removed: the heading is already bold. */
function stripMarks(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}])([*_~])(?=\S)([^\n]*?\S)\2(?![\p{L}\p{N}])/gu, '$1$3');
}

const tidy = (s: string) => s.replace(/[ \t ​]+/g, ' ');

function inline(node: Node, plain: { v: boolean }): string {
  if (node.nodeType === 3) {
    return tidy((node as Text).data.replace(/[\r\n]+/g, ' '));
  }
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return '';
  if (tag === 'br') return '\n';
  let inner = '';
  for (const c of Array.from(el.childNodes)) {
    // A block inside inline content (a div inside a span): keep it on its own line.
    if (c.nodeType === 1 && BLOCK_TAGS.has((c as Element).tagName.toLowerCase())) inner += `\n${inline(c, plain)}\n`;
    else inner += inline(c, plain);
  }
  if (tag === 'a') {
    const href = (el.getAttribute('href') ?? '').trim();
    const text = inner.trim();
    if (/^https?:\/\//i.test(href) && text && !text.includes(href) && text !== href.replace(/^https?:\/\//i, '')) return `${inner} (${href})`;
    return inner;
  }
  if (tag === 'sup' || tag === 'sub') return inner;
  if (plain.v) return inner;
  let out = inner;
  if (!out.trim()) return out;
  if (isStrikeEl(el)) out = wrap(out, '~');
  if (isItalicEl(el)) out = wrap(out, '_');
  if (isBoldEl(el) && tag !== 'th') out = wrap(out, '*');
  return out;
}

/** The words of a block as one line of text (line breaks inside become spaces). */
function oneLine(node: Node): string {
  return inline(node, { v: false }).replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function plainText(node: Node): string {
  return inline(node, { v: true }).replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function isWhollyBold(el: Element): boolean {
  const text = (el.textContent ?? '').replace(/ /g, ' ').trim();
  if (!text) return false;
  let boldChars = 0;
  const walk = (n: Node, bold: boolean) => {
    if (n.nodeType === 3) {
      if (bold) boldChars += (n as Text).data.replace(/\s/g, '').length;
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (SKIP_TAGS.has(e.tagName.toLowerCase())) return;
    const w = styleOf(e, 'fontWeight');
    const b = w ? isBoldEl(e) : bold || isBoldEl(e);
    for (const c of Array.from(e.childNodes)) walk(c, b);
  };
  walk(el, false);
  return boldChars > 0 && boldChars >= text.replace(/\s/g, '').length;
}

/** Whether a short bold line should read as a heading (not a sentence). */
function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_HEADING_CHARS || t.includes('\n')) return false;
  return !/[.,;!]$/.test(t);
}

interface Out {
  lines: string[];
}
function blank(o: Out) {
  if (o.lines.length && o.lines[o.lines.length - 1] !== '') o.lines.push('');
}
function para(o: Out, text: string) {
  blank(o);
  o.lines.push(...text.split('\n'));
  o.lines.push('');
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function table(el: Element, o: Out) {
  const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
  if (!rows.length) return;
  const grid: string[][] = [];
  const pending: number[] = []; // rows still covered by a cell that spans down
  let headerRow = false;
  rows.forEach((tr, r) => {
    const row: string[] = [];
    let col = 0;
    const fillSpans = () => {
      while ((pending[col] ?? 0) > 0) {
        pending[col] -= 1;
        row.push('');
        col += 1;
      }
    };
    for (const cell of Array.from(tr.children)) {
      if (!/^t[dh]$/i.test(cell.tagName)) continue;
      fillSpans();
      const colspan = Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 20);
      const rowspan = Math.min(Math.max(Number(cell.getAttribute('rowspan')) || 1, 1), 50);
      row.push(escapeCell(oneLine(cell)));
      for (let k = 1; k < colspan; k += 1) row.push('');
      for (let k = 0; k < colspan; k += 1) pending[col + k] = rowspan - 1;
      col += colspan;
    }
    fillSpans();
    const cells = Array.from(tr.children).filter((c) => /^t[dh]$/i.test(c.tagName));
    // The first row is the header when it says so (thead, th) or when every cell in it is bold, as Google Docs and Word send it.
    if (r === 0 && rows.length > 1 && (tr.parentElement?.tagName.toLowerCase() === 'thead' || cells.some((c) => c.tagName.toLowerCase() === 'th') || (cells.length > 0 && cells.every((c) => isWhollyBold(c))))) {
      headerRow = true;
      row.splice(0, row.length, ...row.map((x) => stripMarks(x)));
    }
    grid.push(row);
  });
  const width = Math.max(...grid.map((r) => r.length));
  if (width === 0) return;
  // A table with one column is only a list in a box: keep it simple.
  const lines = grid
    .map((r) => {
      const cells = [...r];
      while (cells.length < width) cells.push('');
      return `| ${cells.join(' | ')} |`;
    })
    .filter((l) => l.replace(/[|\s]/g, '') !== '');
  if (!lines.length) return;
  if (headerRow) lines.splice(1, 0, `| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
  blank(o);
  o.lines.push(...lines);
  o.lines.push('');
}

function list(el: Element, o: Out, ordered: boolean, depth: number) {
  let n = 0;
  blank(o);
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') {
      if (/^(ul|ol)$/i.test(li.tagName)) list(li, o, li.tagName.toLowerCase() === 'ol', depth + 1);
      continue;
    }
    n += 1;
    // The item's own words, then any lists inside it.
    const own: Node[] = [];
    const nested: Element[] = [];
    for (const c of Array.from(li.childNodes)) {
      if (c.nodeType === 1 && /^(ul|ol)$/i.test((c as Element).tagName)) nested.push(c as Element);
      else own.push(c);
    }
    const holder = li.ownerDocument.createElement('span');
    own.forEach((c) => holder.appendChild(c.cloneNode(true)));
    const text = oneLine(holder);
    if (text) o.lines.push(`${ordered ? `${n}.` : '-'} ${text}`);
    nested.forEach((nl) => list(nl, o, nl.tagName.toLowerCase() === 'ol', depth + 1));
  }
  o.lines.push('');
}

function walkBlocks(node: Node, o: Out, depth = 0): void {
  if (depth > 60) return;
  // Gather runs of inline content into paragraphs; block elements end the run.
  let run: Node[] = [];
  const flushRun = (asDivLine = false) => {
    if (!run.length) return;
    const holder = (node.ownerDocument ?? (node as Document)).createElement('span');
    run.forEach((c) => holder.appendChild(c.cloneNode(true)));
    run = [];
    const raw = inline(holder, { v: false }).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim();
    if (!raw) return;
    if (asDivLine) o.lines.push(...raw.split('\n'));
    else para(o, raw);
  };

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      if ((child as Text).data.trim() || run.length) run.push(child);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (!BLOCK_TAGS.has(tag)) {
      // An inline wrapper that holds whole paragraphs (Google Docs wraps everything in one <b>): look inside it.
      if (tag !== 'a' && Array.from(el.querySelectorAll('*')).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))) {
        flushRun();
        walkBlocks(el, o, depth + 1);
        continue;
      }
      run.push(el);
      continue;
    }
    flushRun();
    if (/^h[1-6]$/.test(tag)) {
      const text = stripMarks(oneLine(el));
      if (text) {
        // The teaching's title is its own field, so the biggest heading inside the text is a "##".
        para(o, `${Number(tag[1]) <= 2 ? '##' : '###'} ${text}`);
      }
    } else if (tag === 'table') table(el, o);
    else if (tag === 'ul' || tag === 'ol') list(el, o, tag === 'ol', 0);
    else if (tag === 'blockquote') {
      const sub: Out = { lines: [] };
      walkBlocks(el, sub, depth + 1);
      const text = sub.lines.join('\n').trim();
      if (text) para(o, text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (tag === 'hr') blank(o);
    else if (tag === 'pre' || styleOf(el, 'whiteSpace').startsWith('pre')) {
      const text = (el.textContent ?? '').replace(/\r/g, '').replace(/ /g, ' ').replace(/\s+$/, '');
      if (text.trim()) {
        if (tag === 'pre') para(o, text);
        else o.lines.push(...text.split('\n'));
      }
    } else if (tag === 'p' || tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'figcaption') {
      const hasBlockInside = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
      if (hasBlockInside) walkBlocks(el, o, depth + 1);
      else {
        const raw = oneLine(el);
        const bullet = /^[·•▪●○◦‣⁃]\s+(.*)$/.exec(raw); // Word's bullets arrive as a symbol and a space
        if (bullet) {
          if (o.lines.length && o.lines[o.lines.length - 1] !== '' && !/^[-\d]/.test(o.lines[o.lines.length - 1])) blank(o);
          o.lines.push(`- ${bullet[1]}`);
        } else if (raw && isWhollyBold(el) && looksLikeHeading(plainText(el))) para(o, `## ${plainText(el)}`);
        else if (raw) para(o, inline(el, { v: false }).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim());
      }
    } else {
      // div, section and friends: their lines follow each other, a div holding blocks is walked into.
      const hasBlockInside = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
      if (hasBlockInside) {
        walkBlocks(el, o, depth + 1);
        blank(o);
      } else {
        const raw = inline(el, { v: false }).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim();
        if (!raw) {
          // <div><br></div> is an empty line
          if (o.lines.length && o.lines[o.lines.length - 1] !== '') o.lines.push('');
        } else if (isWhollyBold(el) && looksLikeHeading(plainText(el))) para(o, `## ${plainText(el)}`);
        else o.lines.push(...raw.split('\n'));
      }
    }
  }
  flushRun(true);
}

function finish(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The pasted HTML as the app's own text format. Empty when there is nothing to keep. */
export function htmlToMarkup(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return '';
  }
  const o: Out = { lines: [] };
  walkBlocks(doc.body, o);
  return finish(o.lines);
}

// ---------------------------------------------------------------------------
// Plain text (no formatting came with it): tabs mean a table, short title-like lines mean headings.

const BULLET_LINE = /^\s*[•▪●○◦‣⁃–—·]\s+(\S.*)$/;
const KEYWORD_HEADING = /^(chapter|lesson|part|section|week|day|session|unit|module|introduction|conclusion|summary|key (?:points|verses)|chapitre|leçon|lecon|partie|semaine|jour|séance|seance|unité|unite|module|résumé|resume|points clés|versets clés)\b/i;
const NUMBERED_TITLE = /^(?:\d{1,2}|[IVX]{1,6})[.)]\s+\S/;

// "18th Generation 262,144 524,287": a label followed by two or more numbers (spaces, not tabs, between them).
const NUM_TOKEN = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const NUMBER_ROW = new RegExp(String.raw`^\s*(.*?\p{L}.*?)\s+((?:${NUM_TOKEN}\s+)+${NUM_TOKEN})\s*$`, 'u');
function numberRow(line: string): { label: string; nums: string[] } | null {
  const m = NUMBER_ROW.exec(line);
  return m ? { label: m[1].trim(), nums: m[2].trim().split(/\s+/) } : null;
}

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * Plain text with the structure a person can see but a computer can't: bullets typed as symbols
 * become "- " lines, tab-separated rows become a table, and short title-like lines standing above
 * their paragraph become headings. Text that already uses the app's symbols is left as it is.
 */
export function plainToMarkup(text: string): string {
  const src = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = src.split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlank = (s: string | undefined) => s === undefined || !s.trim();
  const nextNonBlank = (from: number): { line: string; gap: number } | null => {
    let gap = 0;
    for (let k = from; k < lines.length; k += 1) {
      if (isBlank(lines[k])) {
        gap += 1;
        if (gap > 1) return null;
        continue;
      }
      return { line: lines[k], gap };
    }
    return null;
  };
  let afterTable = false;
  while (i < lines.length) {
    const line = lines[i];
    const justAfterTable = afterTable;
    afterTable = false;
    // Rows of a label and numbers, separated by spaces (what a book or PDF gives when copied): a table.
    const first = numberRow(line);
    if (first && first.nums.length >= 2) {
      let j = i;
      const rows: { label: string; nums: string[] }[] = [];
      while (j < lines.length) {
        const r = numberRow(lines[j]);
        if (!r || r.nums.length !== first.nums.length) break;
        rows.push(r);
        j += 1;
      }
      if (rows.length >= 3) {
        // A line just above with one word per column (plus the label's word) is the header.
        const above = i > 0 ? lines[i - 1].trim() : '';
        const words = above.split(/\s+/);
        let header: string[] | null = null;
        if (above && out.length && out[out.length - 1] === lines[i - 1] && words.length === first.nums.length + 1 && !/\d/.test(above) && above.length <= 50 && !/[.,;:]$/.test(above)) {
          header = words;
          out.pop();
        }
        if (out.length && out[out.length - 1] !== '') out.push('');
        const row = (c: string[]) => `| ${c.map(escapeCell).join(' | ')} |`;
        if (header) {
          out.push(row(header));
          out.push(`| ${header.map(() => '---').join(' | ')} |`);
        }
        rows.forEach((r) => out.push(row([r.label, ...r.nums])));
        out.push('');
        i = j;
        afterTable = true;
        continue;
      }
    }
    // Tab-separated rows (copied from a spreadsheet as plain text): a table.
    if (line.includes('\t')) {
      let j = i;
      const cols = line.split('\t').length;
      while (j < lines.length && lines[j].includes('\t') && lines[j].split('\t').length === cols) j += 1;
      if (cols >= 2 && j - i >= 2) {
        const rows = lines.slice(i, j).map((r) => r.split('\t').map((c) => escapeCell(c.trim())));
        if (out.length && out[out.length - 1] !== '') out.push('');
        rows.forEach((r) => out.push(`| ${r.join(' | ')} |`));
        out.push('');
        i = j;
        afterTable = true;
        continue;
      }
    }
    const trimmed = line.trim();
    const bullet = BULLET_LINE.exec(line);
    if (bullet && !/^[–—]\s+\S.*\s[–—]\s/.test(trimmed)) {
      out.push(`- ${bullet[1]}`);
      i += 1;
      continue;
    }
    // Lines that already use the app's own symbols are kept as they are.
    if (!trimmed || /^(#{1,3}\s|[-*]\s|>|\|)/.test(trimmed) || /^\d{1,3}[.)]\s/.test(trimmed) && !NUMBERED_TITLE.test(trimmed)) {
      out.push(line);
      i += 1;
      continue;
    }
    const prevBlank = i === 0 || isBlank(lines[i - 1]) || justAfterTable;
    const next = nextNonBlank(i + 1);
    const short = trimmed.length <= 70 && !/[.,;]$/.test(trimmed) && !/^["“'‘(]/.test(trimmed);
    let level = 0;
    if (prevBlank && short && next) {
      const nextLooksBody = next.line.trim().length >= 40 || BULLET_LINE.test(next.line) || /^\s*\d{1,3}[.)]\s/.test(next.line) || next.line.includes('\t') || /^\s*\|/.test(next.line);
      if (isAllCaps(trimmed) || KEYWORD_HEADING.test(trimmed)) level = 2;
      else if (NUMBERED_TITLE.test(trimmed) && nextLooksBody) level = 2;
      else if (nextLooksBody && trimmed.length < next.line.trim().length) level = 3;
    }
    if (level) {
      const clean = trimmed.replace(/^\*+|\*+$/g, '').trim();
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`${'#'.repeat(level)} ${clean}`);
      i += 1;
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Everything a paste needs: the best text for what was copied, or null to let the phone paste normally. */
export function smartPaste(clip: { html: string; plain: string }): string | null {
  let md = '';
  if (clip.html.trim()) md = htmlToMarkup(clip.html);
  if (!md) md = clip.plain.trim() ? plainToMarkup(clip.plain) : '';
  if (!md) return null;
  // The same text with nothing gained: let the normal paste happen (keeps undo, spelling and single words intact).
  if (md === clip.plain.trim() && !clip.html.trim()) return null;
  if (clip.html.trim() && !/^#{1,3} /m.test(md) && !/^\|/m.test(md)) {
    const more = plainToMarkup(md);
    if (more) md = more;
  }
  return md;
}
