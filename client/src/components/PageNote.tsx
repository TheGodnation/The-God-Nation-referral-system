import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMemberAuth } from '../lib/MemberAuthContext';

// A slim, always-visible line at the top of a main page that tells a new member what the page is for (Home = updates,
// Learn = study, Me = add your photos). Nothing has to be tapped to see it; tapping it takes the person there (to the
// posts, to the lessons, to the screen where the photos are added). It is for people who joined in the last 30 days, and
// when `done` is true (for example both photos are added) it goes by itself.

export const NEW_MEMBER_DAYS = 30;

/** True for a signed-in member whose account is younger than 30 days (unknown join date counts as "not new"). */
export function useIsNewMember(): boolean {
  const { member } = useMemberAuth();
  if (!member?.personId || !member.joinedAt) return false;
  const joined = new Date(member.joinedAt).getTime();
  return Number.isFinite(joined) && Date.now() - joined < NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000;
}

const LOOK = 'flex w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-left text-sm text-brand-900 shadow-sm hover:bg-brand-100';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

export function PageNote({ id, children, done = false, to, scrollTo }: { id: string; children: ReactNode; done?: boolean; to?: string; scrollTo?: string }) {
  const isNew = useIsNewMember();
  if (!isNew || done) return null;
  const inner = (
    <>
      <span aria-hidden="true">👋</span>
      <span className="min-w-0 flex-1">{children}</span>
      <span aria-hidden="true" className="text-brand-600">›</span>
    </>
  );
  return (
    <div className="mx-4 sm:mx-0" data-testid={`page-note-${id}`}>
      {to ? (
        <Link to={to} className={`${LOOK} no-underline`}>{inner}</Link>
      ) : (
        <button type="button" className={LOOK} onClick={() => scrollTo && scrollToId(scrollTo)}>{inner}</button>
      )}
    </div>
  );
}
