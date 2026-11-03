import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Shows a page of the public website inside the admin (a full-screen window with a Close button),
// so checking how an article looks never takes the editor out of the app. On a phone with the app
// installed, opening a public page in a new tab leaves the app with no way back; this does not.
export function PublicViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t('knowledgeAdmin.viewer.title') ?? ''} data-testid="kc-viewer">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-brand-900 px-3 py-2 text-white">
        <span className="truncate text-sm font-semibold">{t('knowledgeAdmin.viewer.title')}</span>
        <span className="flex items-center gap-3">
          <a className="text-xs underline" href={url} target="_blank" rel="noreferrer">{t('knowledgeAdmin.viewer.browser')}</a>
          <button type="button" className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-brand-900" onClick={onClose}>{t('knowledgeAdmin.viewer.close')}</button>
        </span>
      </div>
      <iframe title={t('knowledgeAdmin.viewer.title') ?? ''} src={url} className="w-full flex-1 border-0" />
    </div>
  );
}
