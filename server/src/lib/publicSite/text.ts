// Turns an article's text into safe HTML. The text uses a few simple markers, and NOTHING
// else: any HTML typed into an article is shown as plain characters, never run. So an
// editor (or an AI draft) can never put a script, a hidden link or a stray tag into a page.
//
//   ## Heading            ### Smaller heading
//   a blank line          starts a new paragraph
//   - item                a list         1. item   a numbered list
//   > a quotation         (a line inside it starting with "— " is the reference)
//   **bold**  *italic*    [words](https://example.org)  or  [words](/en/about/)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Links may only be web addresses or addresses on this site (never javascript:, data:, etc.). */
const SAFE_URL = /^(https?:\/\/[^\s"<>]+|\/[^\s"<>]*)$/;

function inline(raw: string): string {
  let s = esc(raw);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const u = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(u)) return text;
    const external = /^https?:/.test(u);
    return `<a href="${esc(u)}"${external ? ' rel="noopener noreferrer"' : ''}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

export function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

export interface Heading { id: string; text: string }

/** The "##" headings, for the contents list. */
export function headingsOf(src: string): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    let id = slugOf(m[1]);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n + 1}`;
    out.push({ id, text: m[1] });
  }
  return out;
}

export function renderBody(src: string): string {
  const blocks = src.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const heads = headingsOf(src);
  let h = 0;
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (/^##\s+/.test(lines[0])) {
      const text = lines[0].replace(/^##\s+/, '');
      html.push(`<h2 id="${heads[h]?.id ?? slugOf(text)}">${inline(text)}</h2>`);
      h += 1;
      if (lines.length > 1) html.push(`<p>${lines.slice(1).map(inline).join(' ')}</p>`);
    } else if (/^###\s+/.test(lines[0])) {
      html.push(`<h3>${inline(lines[0].replace(/^###\s+/, ''))}</h3>`);
      if (lines.length > 1) html.push(`<p>${lines.slice(1).map(inline).join(' ')}</p>`);
    } else if (lines.every((l) => /^>\s?/.test(l))) {
      const body: string[] = [];
      let cite = '';
      for (const l of lines) {
        const t = l.replace(/^>\s?/, '');
        if (/^—\s+/.test(t)) cite = t.replace(/^—\s+/, '');
        else body.push(t);
      }
      html.push(`<blockquote><p>${body.map(inline).join(' ')}</p>${cite ? `<cite>${inline(cite)}</cite>` : ''}</blockquote>`);
    } else if (lines.every((l) => /^-\s+/.test(l))) {
      html.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^-\s+/, ''))}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      html.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
    } else {
      html.push(`<p>${lines.map(inline).join(' ')}</p>`);
    }
  }
  return html.join('\n');
}

/** About 200 words a minute, never less than one. */
export function readingMinutes(src: string): number {
  const words = src.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
