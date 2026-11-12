import { useEffect } from 'react';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { listSaved } from '../../lib/offlineStore';
import { loadPdfJs, PDFJS_WORKER_URL } from '../../lib/loadPdfJs';
import { isDataSaverOn } from '../../lib/dataSaver';
import { api } from '../../lib/api';

// The main screens' data, read once per visit (a few small answers) so those screens open offline even when this phone
// has not opened them yet: the api keeps each answer (lib/readCache.ts). Anything else is kept when it is first opened.
const MAIN_READS = [
  '/api/member/me/profile',
  '/api/member/me/community-memberships',
  '/api/member/onboarding',
  '/api/member/friends',
  '/api/member/friends/requests',
  '/api/member/referrals/links',
  '/api/events/summary',
  '/api/prayer-requests',
  '/api/notifications?page=1&pageSize=20',
];
let readsDone = false;
let chatDone = false;
let filesDone = false;

// Quietly fetches (with internet, once per visit) the parts of the app needed to use what is kept on the phone when there
// is no internet — so the phone keeps them (public/sw.js):
//  - the private chat page, so a chat opens offline and shows its last messages (skipped when "Save data" is on);
//  - when books, PDFs or photos are kept: the reader, Downloads, Learn, the school pages and PDF.js.
// It also runs right after a file is kept, so a PDF just viewed opens offline straight away (not only after the next visit).
export function OfflinePrefetch() {
  const { member } = useMemberAuth();
  const personId = member?.personId;
  useEffect(() => {
    if (!personId) return;
    let timer = 0;
    const run = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (!chatDone && !isDataSaverOn()) {
        chatDone = true;
        void Promise.allSettled([import('../../pages/MemberPrivateChatPage'), import('../../pages/MemberDownloadsPage')]);
      }
      if (!readsDone && !isDataSaverOn()) {
        readsDone = true;
        void (async () => {
          for (const path of MAIN_READS) await api.get(path).catch(() => {});
        })();
      }
      if (filesDone) return;
      const saved = await listSaved(personId);
      if (saved.length === 0) return;
      filesDone = true;
      void Promise.allSettled([
        import('../../pages/MemberReaderPage'),
        import('../../pages/MemberDownloadsPage'),
        import('../../pages/MemberSchoolPage'),
        import('../../pages/MemberSchoolBookPage'),
        import('../../pages/MemberLearnPage'),
        loadPdfJs(),
        fetch(PDFJS_WORKER_URL),
      ]);
    };
    const later = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), ms);
    };
    later(4000);
    // A file was just kept: get ready for opening it offline now.
    const onSaved = () => {
      if (!filesDone) later(800);
    };
    window.addEventListener('offline-files-changed', onSaved);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('offline-files-changed', onSaved);
    };
  }, [personId]);
  return null;
}
