import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface DeleteImpact {
  isHeadquarters: boolean;
  members: number;
  subAssemblies: number;
  messages: number;
  teachings: number;
  events: number;
}

// Deleting an assembly or a group: what it removes, where its members go, the typed-name confirmation. Used by the
// admin dashboard and by the central admin's member profile (`base` is the address of the community tools).
export function DeleteCommunityPanel({
  base,
  node,
  onCancel,
  onDone,
}: {
  base: string;
  node: { id: string; name: string; parentId?: string | null; parent?: { id: string; name: string } | null };
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteMoveUp, setDeleteMoveUp] = useState(true);
  // Where the members go: the assembly it sits under (default), nowhere (they just leave), or another one.
  const [deleteMove, setDeleteMove] = useState<'parent' | 'none' | 'other'>(node.parentId ? 'parent' : 'none');
  const [deleteOther, setDeleteOther] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DeleteImpact>(`${base}/${node.id}/delete-impact`)
      .then(setDeleteImpact)
      .catch((err) => setDeleteError(err instanceof ApiError ? err.message : t('admin.communities.delete_failed')));
  }, [base, node.id, t]);

  async function confirmDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteImpact) return;
    const moveTo = deleteImpact.members === 0 ? null : deleteMove === 'parent' ? node.parentId ?? null : deleteMove === 'other' ? deleteOther?.id ?? null : null;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`${base}/${node.id}`, {
        confirmName: deleteConfirm,
        ...(deleteImpact.subAssemblies > 0 && deleteMoveUp ? { subAssemblies: 'moveUp' } : {}),
        ...(moveTo ? { moveMembersTo: moveTo } : {}),
      });
      onDone(t('admin.communities.delete_done', { name: node.name }));
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('admin.communities.delete_failed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
        <form onSubmit={confirmDelete} className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-semibold text-red-800">{t('admin.communities.delete_heading', { name: node.name })}</p>
          {!deleteImpact && !deleteError && <p className="text-slate-500">{t('admin.communities.delete_loading')}</p>}
          {deleteImpact?.isHeadquarters && (
            <p className="text-red-700">{t('admin.communities.delete_is_headquarters')}</p>
          )}
          {deleteImpact && !deleteImpact.isHeadquarters && (
            <>
              <p className="text-slate-700">
                {t('admin.communities.delete_warning', {
                  members: deleteImpact.members,
                  messages: deleteImpact.messages,
                  teachings: deleteImpact.teachings,
                })}
              </p>
              <p className="text-slate-600">{t('admin.communities.delete_people_kept')}</p>
              {deleteImpact.members > 0 && (
                <fieldset className="space-y-2 rounded-lg bg-white p-3" data-testid="delete-members-move">
                  <legend className="px-1 font-semibold text-slate-800">{t('admin.communities.delete_members_where')}</legend>
                  {node.parentId && (
                    <label className="flex items-center gap-2 text-slate-700">
                      <input type="radio" name="delete-move" checked={deleteMove === 'parent'} onChange={() => setDeleteMove('parent')} />
                      {t('admin.communities.delete_members_parent', { name: node.parent?.name ?? '' })}
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-slate-700">
                    <input type="radio" name="delete-move" checked={deleteMove === 'other'} onChange={() => setDeleteMove('other')} />
                    {t('admin.communities.delete_members_other')}
                  </label>
                  {deleteMove === 'other' && (
                    <div className="pl-6">
                      {deleteOther && <p className="mb-1 font-semibold text-brand-900">✔ {deleteOther.name}</p>}
                      <SearchPicker
                        placeholder={t('admin.communities.delete_members_search')}
                        searchPath="/api/admin/communities?search="
                        renderLabel={(c) => c.name}
                        actionLabel={t('admin.communities.delete_members_choose')}
                        searchButtonLabel={t('admin.people.search_button')}
                        onPick={(c) => setDeleteOther({ id: c.id, name: c.name })}
                      />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-slate-700">
                    <input type="radio" name="delete-move" checked={deleteMove === 'none'} onChange={() => setDeleteMove('none')} />
                    {t('admin.communities.delete_members_none')}
                  </label>
                </fieldset>
              )}
              {deleteImpact.subAssemblies > 0 && (
                <label className="flex items-start gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={deleteMoveUp}
                    onChange={(e) => setDeleteMoveUp(e.target.checked)}
                    className="mt-1"
                  />
                  <span>{t('admin.communities.delete_move_up', { count: deleteImpact.subAssemblies })}</span>
                </label>
              )}
              <label className="block">
                <span className="text-slate-700">{t('admin.communities.delete_type_name', { name: node.name })}</span>
                <input
                  className="input mt-1"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {deleteError && <p className="text-red-700">{deleteError}</p>}
          <div className="flex gap-3">
            {deleteImpact && !deleteImpact.isHeadquarters && (
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                disabled={
                  deleting ||
                  (deleteImpact.members > 0 && deleteMove === 'other' && !deleteOther) ||
                  deleteConfirm.trim().toLowerCase() !== node.name.trim().toLowerCase() ||
                  (deleteImpact.subAssemblies > 0 && !deleteMoveUp)
                }
              >
                {deleting ? t('admin.communities.deleting') : t('admin.communities.delete_confirm_button')}
              </button>
            )}
            <button type="button" className="btn-secondary px-4 py-2" onClick={() => onCancel()}>
              {t('admin.communities.delete_cancel')}
            </button>
          </div>
        </form>
  );
}
