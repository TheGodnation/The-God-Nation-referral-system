import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';

// Turns web addresses inside message text into tappable links that open in a
// new browser tab. Only http(s) addresses ever become links, so nothing
// like "javascript:" can be slipped in. Addresses written without
// "https://" (www.… or name.org) are linked too, but an email address is
// left alone.

const TLDS = 'org|com|net|edu|gov|io|app|co|cm|ng|fr|uk|info|church|ministry|tv|me|africa';
// A link never ends with a formatting mark (*bold*, _italic_, ~crossed~ around it) or a dash/ellipsis after it.
const TRAILING = `[^\\s<]*[^\\s<.,;:!?'")\\]}»”’*_~—–…]`;
// A bare address (name.org) must not start in the middle of a word or after
// "@" (an email). That is checked with a leading character group, not with a
// "lookbehind": older iPhones (iOS before 16.4) cannot even create
// such an expression, and it broke every screen that shows chat text.
// An address written between < and > is a link sent without its preview card (see LinkPreviewCard): the marks are not shown.
const ADDRESS = new RegExp(
  `<(https?:\\/\\/[^\\s<>]+)>|(?:https?:\\/\\/|www\\.)${TRAILING}|(^|[^@\\w.\\/-])((?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?![@\\w-])(?:\\/${TRAILING})?)`,
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
    if (m[1] !== undefined) {
      // <https://…>: the link without the marks around it.
      const from = m.index ?? 0;
      if (from > last) parts.push({ text: text.slice(last, from), href: null });
      parts.push({ text: m[1], href: m[1] });
      last = from + m[0].length;
      continue;
    }
    // A bare address comes with the one character before it (group 2): the link starts after that.
    const shown = m[3] ?? m[0];
    const at = (m.index ?? 0) + (m[3] !== undefined ? (m[2] ?? '').length : 0);
    if (at > last) parts.push({ text: text.slice(last, at), href: null });
    parts.push({ text: shown, href: /^https?:\/\//i.test(shown) ? shown : `https://${shown}` });
    last = at + shown.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), href: null });
  return parts;
}

/** The path inside the app when the address is on our own site (the same host, with or without "www."), otherwise null. */
function ownPath(href: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const url = new URL(href);
    const bare = (h: string) => h.replace(/^www\./i, '').toLowerCase();
    if (url.protocol === window.location.protocol && bare(url.host) === bare(window.location.host)) return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Not a readable address: treat it as outside.
  }
  return null;
}

/**
 * Where a link opens. An address on our own site opens in the same window: in
 * the installed app a "new tab" for our own address flashed and left the app
 * with nothing shown, and a new tab has no history so "back" did nothing. Any
 * other site opens in a new tab, as before.
 */
function linkTarget(href: string): { target?: '_blank'; rel?: string } {
  if (ownPath(href) !== null) return {};
  return { target: '_blank', rel: 'noopener noreferrer' };
}

const linkClass = 'break-all text-sky-700 underline';

/** A link on our own site goes through the app's router (no page reload, so the phone's back button returns to the message). */
function RouterAnchor({ href, path, children }: { href: string; path: string; children: ReactNode }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
  return (
    <a href={href} onClick={onClick} className={linkClass}>
      {children}
    </a>
  );
}

/** One address in a message: inside the app when it is ours, a new tab otherwise. */
function SiteAnchor({ href, children }: { href: string; children: ReactNode }) {
  const inRouter = useInRouterContext();
  const path = ownPath(href);
  // Only the member screens are inside the app; other pages of the site (the guides, the articles) are loaded from the server.
  if (inRouter && path !== null && path.startsWith('/member/')) return <RouterAnchor href={href} path={path}>{children}</RouterAnchor>;
  return (
    <a href={href} {...linkTarget(href)} onClick={(e) => e.stopPropagation()} className={linkClass}>
      {children}
    </a>
  );
}

/** One tappable link (used by the text formatter too). */
export function LinkAnchor({ href, children }: { href: string; children: ReactNode }) {
  return <SiteAnchor href={href}>{children}</SiteAnchor>;
}

/** The text with its web addresses turned into links. */
export function Linkified({ text }: { text: string | null | undefined }): ReactNode {
  if (!text) return null;
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <SiteAnchor key={i} href={p.href}>{p.text}</SiteAnchor>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
