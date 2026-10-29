import { Fragment, type ReactNode } from 'react';

// Turns web addresses inside message text into tappable links that open in a
// new browser tab. Only http(s) addresses ever become links, so nothing
// like "javascript:" can be slipped in. Addresses written without
// "https://" (www.… or name.org) are linked too, but an email address is
// left alone.

const TLDS = 'org|com|net|edu|gov|io|app|co|cm|ng|fr|uk|info|church|ministry|tv|me|africa';
const TRAILING = `[^\\s<]*[^\\s<.,;:!?'")\\]}»”’]`;
// A bare address (name.org) must not start in the middle of a word or after
// "@" (an email). That is checked with a leading character group, not with a
// "lookbehind": older iPhones (iOS before 16.4) cannot even create
// such an expression, and it broke every screen that shows chat text.
const ADDRESS = new RegExp(
  `(?:https?:\\/\\/|www\\.)${TRAILING}|(^|[^@\\w.\\/-])((?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?![@\\w-])(?:\\/${TRAILING})?)`,
  'gi',
);

export interface LinkPart {
  text: string;
  href: string | null;
}

/** Splits text into plain pieces and link pieces. */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(ADDRESS)) {
    // A bare address comes with the one character before it (group 1): the link starts after that.
    const shown = m[2] ?? m[0];
    const at = (m.index ?? 0) + (m[2] !== undefined ? (m[1] ?? '').length : 0);
    if (at > last) parts.push({ text: text.slice(last, at), href: null });
    parts.push({ text: shown, href: /^https?:\/\//i.test(shown) ? shown : `https://${shown}` });
    last = at + shown.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null });
  return parts;
}

/** One tappable link (used by the text formatter too). */
export function LinkAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="break-all text-sky-700 underline">
      {children}
    </a>
  );
}

/** The text with its web addresses turned into links. */
export function Linkified({ text }: { text: string | null | undefined }): ReactNode {
  if (!text) return null;
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="break-all text-sky-700 underline"
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
