import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface PersonRow {
  id: string;
  name: string;
  whatsappNumber: string;
  email: string | null;
  preferredLanguage: string;
  geographicAssignment: { geography: { id: string; name: string; type: string } } | null;
  _count: { communityMemberships: number; registrations: number };
}

interface PersonDetail extends Omit<PersonRow, 'geographicAssignment'> {
  geographicAssignment: {
    id: string;
    geography: { id: string; name: string; type: string; countryCode: string };
  } | null;
  communityMemberships: {
    id: string;
    status: 'ACTIVE' | 'INACTIVE';
    joinedAt: string;
    community: { id: string; name: string };
  }[];
  registrations: { id: string; language: string; pathway: string; createdAt: string }[];
  users: { id: string; name: string; email: string; role: string }[];
}

const EMPTY_PERSON_FORM = { name: '', whatsappNumber: '', email: '', preferredLanguage: 'en' as 'en' | 'fr' };

export function PeopleTab({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PersonRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_PERSON_FORM);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_PERSON_FORM);
  const [detailError, setDetailError] = useState<string | null>(null);

  function load() {
    const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
    api
      .get<{ items: PersonRow[]; pagination: { totalPages: number } }>(
        `/api/admin/people?page=${page}&pageSize=20&includeTestData=${includeTestData}${q}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page, includeTestData]);

  function loadDetail(id: string) {
    api.get<PersonDetail>(`/api/admin/people/${id}`).then((p) => {
      setDetail(p);
      setEditForm({
        name: p.name,
        whatsappNumber: p.whatsappNumber,
        email: p.email ?? '',
        preferredLanguage: p.preferredLanguage as 'en' | 'fr',
      });
    });
  }

  function openPerson(id: string) {
    setSelectedId(id);
    setDetailError(null);
    loadDetail(id);
  }

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    load();
  }

  async function createPerson(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/people', {
        name: form.name,
        whatsappNumber: form.whatsappNumber,
        email: form.email || undefined,
        preferredLanguage: form.preferredLanguage,
      });
      setForm(EMPTY_PERSON_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.people.create_failed'));
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.patch(`/api/admin/people/${selectedId}`, {
        name: editForm.name,
        whatsappNumber: editForm.whatsappNumber,
        email: editForm.email || null,
        preferredLanguage: editForm.preferredLanguage,
      });
      loadDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.people.save_failed'));
    }
  }

  async function assignGeography(geo: any) {
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.put(`/api/admin/people/${selectedId}/geographic-assignment`, { geographyId: geo.id });
      loadDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.people.assign_failed'));
    }
  }

  async function addMembership(community: any) {
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.post(`/api/admin/people/${selectedId}/community-memberships`, { communityId: community.id });
      loadDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.people.membership_failed'));
    }
  }

  async function toggleMembership(membershipId: string, currentStatus: string) {
    await api.patch(`/api/admin/community-memberships/${membershipId}`, {
      status: currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    });
    if (selectedId) loadDetail(selectedId);
  }

  if (selectedId && detail) {
    return (
      <div>
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={backToList}>
          {t('admin.people.back_to_list')}
        </button>

        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <h2 className="font-semibold text-brand-900">{t('admin.people.edit_person')}</h2>
          <div>
            <label className="label">{t('admin.people.name_label')}</label>
            <input
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('admin.people.whatsapp_label')}</label>
            <input
              className="input"
              value={editForm.whatsappNumber}
              onChange={(e) => setEditForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('admin.people.email_label')}</label>
            <input
              className="input"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('admin.people.language_label')}</label>
            <select
              className="input"
              value={editForm.preferredLanguage}
              onChange={(e) => setEditForm((f) => ({ ...f, preferredLanguage: e.target.value as 'en' | 'fr' }))}
            >
              <option value="en">{t('common.language_en')}</option>
              <option value="fr">{t('common.language_fr')}</option>
            </select>
          </div>
          {detailError && <p className="text-sm text-red-700">{detailError}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.people.save_changes')}
          </button>
        </form>

        <div className="card mb-4 space-y-3">
          <h2 className="font-semibold text-brand-900">{t('admin.people.geographic_assignment')}</h2>
          <p className="text-sm text-slate-600">
            {detail.geographicAssignment
              ? `${detail.geographicAssignment.geography.name} (${detail.geographicAssignment.geography.type})`
              : t('admin.people.no_assignment')}
          </p>
          <SearchPicker
            placeholder={t('admin.people.search_geography_placeholder') ?? ''}
            searchPath="/api/admin/geography?search="
            renderLabel={(g) => `${g.name} (${g.type}, ${g.countryCode})`}
            actionLabel={t('admin.people.assign')}
            searchButtonLabel={t('admin.people.search_button')}
            onPick={assignGeography}
          />
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold text-brand-900">{t('admin.people.community_memberships')}</h2>
          {detail.communityMemberships.length === 0 ? (
            <p className="text-sm text-slate-400">{t('admin.people.no_memberships')}</p>
          ) : (
            <ul className="space-y-2">
              {detail.communityMemberships.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                  <span>
                    {m.community.name} —{' '}
                    <span className={m.status === 'ACTIVE' ? 'text-green-700' : 'text-slate-400'}>
                      {m.status === 'ACTIVE' ? t('admin.people.status_active') : t('admin.people.status_inactive')}
                    </span>
                  </span>
                  <button className="text-brand-700 hover:underline" onClick={() => toggleMembership(m.id, m.status)}>
                    {m.status === 'ACTIVE' ? t('admin.people.deactivate') : t('admin.people.activate')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SearchPicker
            placeholder={t('admin.people.search_community_placeholder') ?? ''}
            searchPath="/api/admin/communities?search="
            renderLabel={(c) => c.name}
            actionLabel={t('admin.people.add')}
            searchButtonLabel={t('admin.people.search_button')}
            onPick={addMembership}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.people.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.people.new_person')}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
        className="mb-4 flex gap-2"
      >
        <input
          className="input"
          placeholder={t('admin.people.search_placeholder') ?? ''}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-secondary" type="submit">
          {t('admin.people.search_button')}
        </button>
      </form>

      {error && !showForm && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={createPerson} className="card mb-4 space-y-3">
          <input
            className="input"
            placeholder={t('admin.people.name_placeholder') ?? ''}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder={t('admin.people.whatsapp_placeholder') ?? ''}
            value={form.whatsappNumber}
            onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
            required
          />
          <input
            className="input"
            type="email"
            placeholder={t('admin.people.email_placeholder') ?? ''}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.people.create')}
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.people.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_whatsapp')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_geography')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_communities')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => openPerson(p.id)}>
                    {t('admin.people.view')}
                  </button>
                </td>
                <td className="py-2 pr-4">{p.name}</td>
                <td className="py-2 pr-4">{p.whatsappNumber}</td>
                <td className="py-2 pr-4">{p.geographicAssignment?.geography.name ?? '—'}</td>
                <td className="py-2 pr-4">{p._count.communityMemberships}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-400">
                  {t('admin.people.no_people')}
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
    </div>
  );
}
