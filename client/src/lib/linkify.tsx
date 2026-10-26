import { Fragment, type ReactNode } from 'react';

// Turns web addresses inside message text into tappable links that open in a
// new browser tab. Only http(s) addresses ever become links, so nothing
// like "javascript:" can be slipped in. Addresses written without
// "https://" (www.… or name.org) are linked too, but an email address is
// left alone.

const TLDS = 'org|com|net|edu|gov|io|app|co|cm|ng|fr|uk|info|church|ministry|tv|me|africa';
const TRAILING = `[^\\s<]*[^\\s<.,;:!?'")\\]}»”’]`;
const ADDRESS = new RegExp(
  `(?:https?:\\/\\/|www\\.)${TRAILING}|(?<![@\\w.\\/-])(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?![@\\w-])(?:\\/${TRAILING})?`,
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
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), href: null });
    const shown = m[0];
    parts.push({ text: shown, href: /^https?:\/\//i.test(shown) ? shown : `https://${shown}` });
    last = at + shown.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null });
  return parts;
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
