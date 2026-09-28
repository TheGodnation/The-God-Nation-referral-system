import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface CommunityBreakdown {
  communityId: string;
  communityName: string;
  count: number;
}

interface LocationGroup {
  country: string | null;
  city: string | null;
  area: string | null;
  memberCount: number;
  assignedCount: number;
  unassignedCount: number;
  communities: CommunityBreakdown[];
}

// Member Location & Central Authority Location Intelligence phase — a
// read-only aggregation view over the member-provided, descriptive
// Person.locationCountry/locationCity/locationArea fields (see
// GET /api/admin/locations). This is intelligence only: it never creates a
// Community, never assigns a member, and never links location to any
// authority — Central Authority uses it purely to decide, manually, whether
// a new Community might be warranted. No individual Person data (name,
// WhatsApp, email) is ever returned by the server for this view.
export function LocationsTab({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<LocationGroup[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<{ items: LocationGroup[]; pagination: { totalPages: number } }>(
        `/api/admin/locations?page=${page}&pageSize=20&includeTestData=${includeTestData}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
        setLoading(false);
      })
      .catch(() => {
        setError(t('admin.locations.load_failed'));
        setLoading(false);
      });
  }

  useEffect(load, [page, includeTestData]);

  return (
    <div>
      <h2 className="mb-2 font-semibold text-brand-900">{t('admin.locations.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('admin.locations.description')}</p>

      {loading && <p className="text-sm text-slate-400">{t('admin.loading')}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('admin.locations.table_country')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_city')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_area')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_member_count')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_assigned_count')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_unassigned_count')}</th>
                <th className="py-2 pr-4">{t('admin.locations.table_communities')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g, idx) => (
                <tr key={idx} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-4">{g.country ?? '—'}</td>
                  <td className="py-2 pr-4">{g.city ?? '—'}</td>
                  <td className="py-2 pr-4">{g.area ?? '—'}</td>
                  <td className="py-2 pr-4">{g.memberCount}</td>
                  <td className="py-2 pr-4">{g.assignedCount}</td>
                  <td className="py-2 pr-4">{g.unassignedCount}</td>
                  <td className="py-2 pr-4">
                    {g.communities.length === 0
                      ? '—'
                      : g.communities.map((c) => `${c.communityName} (${c.count})`).join(', ')}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-400">
                    {t('admin.locations.no_data')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('admin.prev')}
              </button>
              <span>{t('admin.page_of', { page, total: totalPages })}</span>
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('admin.next')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
