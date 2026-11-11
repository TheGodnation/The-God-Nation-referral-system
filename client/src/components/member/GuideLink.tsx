import type { ReactNode } from 'react';
import { isStandalone } from '../../lib/push';

// A link to one of the plain help pages (install, notifications, phone settings). Inside the installed app a new
// window can open blank or throw the person out of the app, so there it opens in the same window (Back returns);
// in a normal browser it opens in a new tab as before.
export function GuideLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (isStandalone()) {
          e.preventDefault();
          window.location.assign(href);
        }
      }}
    >
      {children}
    </a>
  );
}
