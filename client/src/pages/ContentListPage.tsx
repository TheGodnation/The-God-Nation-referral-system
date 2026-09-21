import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { api } from '../lib/api';

interface ContentPageSummary {
  slug: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  publishedAt: string | null;
}

// Public, unauthenticated Teachings / Announcements listing — published
// content only. Both are simple dated public posts: no comments, reactions,
// or engagement scoring (Section 6).
export function ContentListPage({ type }: { type: 'TEACHING' | 'ANNOUNCEMENT' }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ContentPageSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    api
      .get<{ items: ContentPageSummary[] }>(`/api/content-pages?type=${type}`)
      .then((res) => setItems(res.items))
      .finally(() => setLoaded(true));
  }, [type]);

  const isFr = i18n.language.startsWith('fr');
  const titleKey = type === 'TEACHING' ? 'content.teachings_title' : 'content.announcements_title';
  const heading = t(titleKey);

  useDocumentMeta(heading);

  return (
    <PageShell>
      <section className="mx-auto max-w-2xl px-4 py-14">
        <h1 className="text-2xl font-bold text-brand-900 sm:text-3xl">{heading}</h1>
        {!loaded ? (
          <p className="mt-8 text-center text-slate-400">{t('content.loading')}</p>
        ) : items.length === 0 ? (
          <p className="mt-8 text-center text-slate-400">{t('content.no_items')}</p>
        ) : (
          <ul className="mt-8 space-y-6">
            {items.map((item) => {
              const title = isFr ? item.titleFr || item.titleEn : item.titleEn;
              const body = isFr ? item.bodyFr || item.bodyEn : item.bodyEn;
              return (
                <li key={item.slug} className="card">
                  <Link to={`/page/${item.slug}`} className="font-semibold text-brand-900 hover:underline">
                    {title}
                  </Link>
                  <p className="mt-2 line-clamp-3 text-sm text-slate-600">{body}</p>
                  {item.publishedAt && (
                    <p className="mt-2 text-xs text-slate-400">{new Date(item.publishedAt).toLocaleDateString()}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
