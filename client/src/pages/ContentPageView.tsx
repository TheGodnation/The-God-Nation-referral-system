import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { api, ApiError } from '../lib/api';

interface ContentPageData {
  slug: string;
  type: 'PAGE' | 'TEACHING' | 'ANNOUNCEMENT';
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  mediaUrl: string | null;
  publishedAt: string | null;
}

// Public, unauthenticated single content page — Vision/Mission, a Teaching,
// or an Announcement, all rendered the same way. Section 9: predictable
// slug-based URL (/page/:slug). Unpublished/missing slugs both 404 the same
// way, so a draft's existence is never revealed to a visitor.
export function ContentPageView() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<ContentPageData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setNotFound(false);
    setPage(null);
    if (!slug) return;
    api
      .get<ContentPageData>(`/api/content-pages/${slug}`)
      .then((data) => setPage(data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoaded(true));
  }, [slug]);

  const isFr = i18n.language.startsWith('fr');
  const title = page ? (isFr ? page.titleFr || page.titleEn : page.titleEn) : '';
  const body = page ? (isFr ? page.bodyFr || page.bodyEn : page.bodyEn) : '';

  useDocumentMeta(title || t('content.loading'), body ? body.slice(0, 160) : undefined);

  if (!loaded) {
    return (
      <PageShell>
        <div className="px-4 py-24 text-center text-slate-400">{t('content.loading')}</div>
      </PageShell>
    );
  }

  if (notFound || !page) {
    return (
      <PageShell>
        <div className="px-4 py-24 text-center">
          <p className="text-slate-500">{t('content.not_found')}</p>
          <Link to="/" className="mt-4 inline-block text-brand-700 hover:underline">
            {t('common.back_home')}
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <article className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="text-2xl font-bold text-brand-900 sm:text-3xl">{title}</h1>
        <div className="mt-6 whitespace-pre-wrap text-slate-600">{body}</div>
        {page.mediaUrl && (
          <div className="mt-6">
            <a
              href={page.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-brand-700 hover:underline"
            >
              {page.mediaUrl}
            </a>
          </div>
        )}
      </article>
    </PageShell>
  );
}
