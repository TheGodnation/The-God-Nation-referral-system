import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemberAuth } from '../lib/MemberAuthContext';

// A short bright-blue note at the top of a main page that tells a member what the page is for (Home = updates,
// Learn = study, Me = add your photos). It stays until they close it with the ✕ (remembered per person on this phone),
// It is for people who joined in the last 30 days. Or, when `done` is true (for example both photos are added), it goes by itself.
const NEW_MEMBER_DAYS = 30;

export function PageNote({ id, children, done = false }: { id: string; children: ReactNode; done?: boolean }) {
  const { t } = useTranslation();
  const { member } = useMemberAuth();
  const key = `godnation:note-closed:${id}:${member?.personId ?? ''}`;
  const read = () => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const [closed, setClosed] = useState(read);
  useEffect(() => setClosed(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const joined = member?.joinedAt ? new Date(member.joinedAt).getTime() : NaN;
  const isNew = Number.isFinite(joined) && Date.now() - joined < NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000;
  if (!member?.personId || done || closed || !isNew) return null;

  function close() {
    setClosed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* private mode: it only lasts for this visit */
    }
  }

  return (
    <div role="note" className="mx-4 flex items-start gap-2 rounded-xl bg-brand-600 p-3 text-sm text-white shadow sm:mx-0" data-testid={`page-note-${id}`}>
      <span aria-hidden="true">👋</span>
      <div className="min-w-0 flex-1">{children}</div>
      <button type="button" aria-label={t('pageNotes.close') ?? ''} onClick={close} className="px-1 leading-5 text-white/80" data-testid={`page-note-close-${id}`}>
        ✕
      </button>
    </div>
  );
}
