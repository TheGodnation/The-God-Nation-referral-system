import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';
import { PrivateMessages } from '../PrivateMessages';

type Scope = 'ALL_ELIGIBLE' | 'SELECTED_MEMBERS' | 'SELECTED_COMMUNITY' | 'ALL_LEADERS';

// Private Communication / Messaging — Admin (Central Authority) management
// surface. Initiation only (see server/src/routes/adminPrivateMessages.ts);
// ordinary participation in an already-created conversation (including one
// this Admin initiated) happens through the embedded <PrivateMessages />
// inbox below, the same shared component used by Member/Leader dashboards.
export function PrivateMessagesTab() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>('ALL_ELIGIBLE');
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  function addMember(person: { id: string; name: string }) {
    setMembers((prev) => (prev.some((m) => m.id === person.id) ? prev : [...prev, person]));
  }

  function removeMember(index: number) {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    setSentMessage(null);
    try {
      const payload =
        scope === 'SELECTED_MEMBERS'
          ? { scope, personIds: members.map((m) => m.id), body: trimmed }
          : scope === 'SELECTED_COMMUNITY'
            ? { scope, communityId, body: trimmed }
            : { scope, body: trimmed };
      const res = await api.post<{ targetCount: number }>('/api/admin/private-messages/conversations', payload);
      setSentMessage(t('admin.privateMessages.sent_success', { count: res.targetCount }));
      setBody('');
      setMembers([]);
      setCommunityId('');
      setCommunityName('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('admin.privateMessages.send_failed'));
    } finally {
      setSending(false);
    }
  }

  const canSend =
    body.trim().length > 0 &&
    (scope === 'ALL_ELIGIBLE' || scope === 'ALL_LEADERS' || (scope === 'SELECTED_MEMBERS' && members.length > 0) || (scope === 'SELECTED_COMMUNITY' && Boolean(communityId)));

  return (
    <div>
      <h2 className="mb-2 font-semibold text-brand-900">{t('admin.privateMessages.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('admin.privateMessages.description')}</p>

      <div className="card mb-6 space-y-4">
        <div>
          <label className="label">{t('admin.privateMessages.scope_label')}</label>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'ALL_ELIGIBLE'} onChange={() => setScope('ALL_ELIGIBLE')} />
              {t('admin.privateMessages.scope_all_eligible')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'SELECTED_MEMBERS'} onChange={() => setScope('SELECTED_MEMBERS')} />
              {t('admin.privateMessages.scope_selected_members')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'SELECTED_COMMUNITY'} onChange={() => setScope('SELECTED_COMMUNITY')} />
              {t('admin.privateMessages.scope_selected_community')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'ALL_LEADERS'} onChange={() => setScope('ALL_LEADERS')} />
              {t('admin.privateMessages.scope_all_leaders')}
            </label>
          </div>
        </div>

        {scope === 'SELECTED_MEMBERS' && (
          <div>
            <label className="label">{t('admin.privateMessages.members_label')}</label>
            {members.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {members.map((m, i) => (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <span>{m.name}</span>
                    <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => removeMember(i)}>
                      {t('admin.privateMessages.remove_target')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-xs text-slate-400">{t('admin.privateMessages.no_members_selected')}</p>
            )}
            <SearchPicker
              placeholder={t('admin.privateMessages.search_member_placeholder') ?? ''}
              searchPath="/api/admin/people?search="
              renderLabel={(p) => p.name}
              actionLabel={t('admin.privateMessages.add_member')}
              searchButtonLabel={t('admin.privateMessages.search_button')}
              onPick={(p) => addMember({ id: p.id, name: p.name })}
            />
          </div>
        )}

        {scope === 'SELECTED_COMMUNITY' && (
          <div>
            <label className="label">{t('admin.privateMessages.community_label')}</label>
            <p className="mb-2 text-sm text-slate-600">{communityName || '—'}</p>
            <SearchPicker
              placeholder={t('admin.privateMessages.search_community_placeholder') ?? ''}
              searchPath="/api/admin/communities?search="
              renderLabel={(c) => c.name}
              actionLabel={t('admin.privateMessages.select')}
              searchButtonLabel={t('admin.privateMessages.search_button')}
              onPick={(c) => {
                setCommunityId(c.id);
                setCommunityName(c.name);
              }}
            />
          </div>
        )}

        <div>
          <label className="label">{t('admin.privateMessages.body_label')}</label>
          <textarea className="input" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {sendError && <p className="text-sm text-red-700">{sendError}</p>}
        {sentMessage && <p className="text-sm text-green-700">{sentMessage}</p>}
        <button className="btn-primary" disabled={sending || !canSend} onClick={send}>
          {sending ? t('admin.privateMessages.sending') : t('admin.privateMessages.send')}
        </button>
      </div>

      <h3 className="mb-2 font-semibold text-brand-900">{t('admin.privateMessages.inbox_heading')}</h3>
      <PrivateMessages alwaysShow />
    </div>
  );
}
