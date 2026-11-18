import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemberAuth } from '../lib/MemberAuthContext';

// A short bright-blue note at the top of a main page that tells a member what the page is for (Home = updates,
// Learn = study, Me = add your photos). It stays until they close it with the ✕ (remembered per person on this phone),
// or, when `done` is true (for example both photos are added), it goes by itself.
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

  if (!member?.personId || done || closed) return null;

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
