import { useEffect } from 'react';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { listSaved } from '../../lib/offlineStore';
import { loadPdfJs, PDFJS_WORKER_URL } from '../../lib/loadPdfJs';

let done = false;

// When a member has books or documents downloaded on this phone, quietly
// fetch (once per visit, with internet) the parts of the app needed to
// open them offline — the reader, Downloads, the school pages and PDF.js —
// so the phone keeps them (public/sw.js) for when there is no internet.
export function OfflinePrefetch() {
  const { member } = useMemberAuth();
  const personId = member?.personId;
  useEffect(() => {
    if (done || !personId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const timer = window.setTimeout(async () => {
      if (done) return;
      const saved = await listSaved(personId);
      if (saved.length === 0) return;
      done = true;
      void Promise.allSettled([
        import('../../pages/MemberReaderPage'),
        import('../../pages/MemberDownloadsPage'),
        import('../../pages/MemberSchoolPage'),
        import('../../pages/MemberSchoolBookPage'),
        loadPdfJs(),
        fetch(PDFJS_WORKER_URL, { mode: 'no-cors' }),
      ]);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [personId]);
  return null;
}
