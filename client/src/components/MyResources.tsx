import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

interface ResourceRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  url: string | null;
}

// Book / Resource Access Grants — a shared authenticated recipient view,
// used identically by both the Member and Leader dashboards (same API,
// same display rules as Announcements.tsx/HeadquartersPosts.tsx). Every
// Resource shown here is one the caller currently holds an ACTIVE grant
// for (server-enforced via lib/resourceAccess.ts) — Leader status and
// Community membership grant nothing on their own. Silent-hide when there
// is nothing to show, matching the established convention for an
// inapplicable section.
export function MyResources({ alwaysShow = false }: { alwaysShow?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ResourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: ResourceRow[] }>('/api/me/resources')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('myResources.load_failed'));
        setLoading(false);
      });
  }, []);

  if (loading) return null;
  if (!alwaysShow && !error && items.length === 0) return null;

  const isFr = i18n.language.startsWith('fr');

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('myResources.title')}</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && items.length === 0 && <p className="text-sm text-slate-400">{t('myResources.no_resources')}</p>}
      {!error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((r) => {
            const title = isFr ? r.titleFr || r.titleEn : r.titleEn;
            const description = isFr ? r.descriptionFr || r.descriptionEn : r.descriptionEn;
            return (
              <li key={r.id} className="border-b border-slate-50 pb-2 text-sm">
                <p className="font-semibold text-brand-900">{title}</p>
                {description && <p className="text-slate-600">{description}</p>}
                {r.url && (
                  <a className="text-brand-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">
                    {t('myResources.open')}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
