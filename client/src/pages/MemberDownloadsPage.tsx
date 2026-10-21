import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { PdfViewer } from '../components/chat/PdfViewer';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { deleteSaved, getFile, listSaved, storageEstimate, type SavedInfo } from '../lib/offlineStore';

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

// "Downloads": the leadership books and chat documents kept on this phone
// (they open without internet), how much room they take, and deleting
// them. Works offline too — nothing here needs the server.
export function MemberDownloadsPage() {
  const { t, i18n } = useTranslation();
  const { member } = useMemberAuth();
  const ownerId = member?.personId ?? '';
  const [items, setItems] = useState<SavedInfo[] | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [viewing, setViewing] = useState<{ name: string; data: Blob } | null>(null);

  function load() {
    if (!ownerId) return;
    listSaved(ownerId).then(setItems);
    storageEstimate().then((e) => setUsage(e?.usage ?? null));
  }
  useEffect(() => {
    load();
    window.addEventListener('offline-files-changed', load);
    return () => window.removeEventListener('offline-files-changed', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const books = (items ?? []).filter((i) => i.kind === 'BOOK');
  const docs = (items ?? []).filter((i) => i.kind === 'DOC');
  const total = (items ?? []).reduce((sum, i) => sum + i.byteSize, 0);
  const isFr = i18n.language.startsWith('fr');
  const bookTitle = (i: SavedInfo) => {
    const meta = (i.meta ?? {}) as { titleEn?: string; titleFr?: string | null; trainingOrder?: number | null };
    const name = (isFr && meta.titleFr) || meta.titleEn || i.title;
    return meta.trainingOrder ? `${t('learn.book', { number: meta.trainingOrder })}: ${name}` : name;
  };

  async function openDoc(i: SavedInfo) {
    const file = await getFile(i.key);
    if (file) setViewing({ name: i.title, data: file.blob });
  }

  const row = (i: SavedInfo, label: string, action: JSX.Element) => (
    <li key={i.key} className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-800">{label}</span>
        <span className="text-xs text-slate-500">
          {mb(i.byteSize)} · {new Date(i.savedAt).toLocaleDateString()}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {action}
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => window.confirm(t('downloads.confirm_delete') ?? '') && deleteSaved([i.key])}>
          {t('downloads.delete')}
        </button>
      </span>
    </li>
  );

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <Link to="/member/me" className="text-sm text-brand-700 hover:underline">
          ← {t('downloads.back')}
        </Link>
        <h1 className="text-2xl font-bold text-brand-900">📥 {t('downloads.title')}</h1>
        <p className="text-sm text-slate-600">{t('downloads.intro')}</p>
        {items !== null && (
          <p className="text-sm text-slate-700">
            {t('downloads.using', { size: mb(total) })}
            {usage !== null && usage > total * 1.5 && <span className="text-slate-500"> · {t('downloads.app_total', { size: mb(usage) })}</span>}
          </p>
        )}

        <section className="card">
          <h2 className="mb-1 font-semibold text-brand-900">🎓 {t('downloads.books')}</h2>
          {books.length === 0 ? (
            <p className="text-sm text-slate-500">{t('downloads.no_books')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {books.map((i) =>
                row(
                  i,
                  bookTitle(i),
                  <Link to={`/member/read/${String((i.meta as { id?: string })?.id ?? '')}`} className="btn-secondary px-3 py-1 text-xs">
                    {t('downloads.open')}
                  </Link>,
                ),
              )}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="mb-1 font-semibold text-brand-900">📄 {t('downloads.documents')}</h2>
          {docs.length === 0 ? (
            <p className="text-sm text-slate-500">{t('downloads.no_documents')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((i) =>
                row(
                  i,
                  i.title,
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => openDoc(i)}>
                    {t('downloads.open')}
                  </button>,
                ),
              )}
            </ul>
          )}
        </section>

        {(items?.length ?? 0) > 0 && (
          <button
            type="button"
            className="text-sm text-red-700 underline"
            onClick={() => window.confirm(t('downloads.confirm_delete_all') ?? '') && deleteSaved((items ?? []).map((i) => i.key))}
          >
            {t('downloads.delete_all')}
          </button>
        )}
        <MemberNav />
      </section>
      {viewing && <PdfViewer data={viewing.data} name={viewing.name} onClose={() => setViewing(null)} />}
    </PageShell>
  );
}
