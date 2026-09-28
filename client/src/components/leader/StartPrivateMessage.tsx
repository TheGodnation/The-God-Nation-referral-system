import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from '../admin/SearchPicker';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
}

// Private Communication / Messaging — a Leader's own compose/start-message
// action, deliberately restricted to members of exact Communities the
// Leader currently holds an ACTIVE SCOPED_LEADER role for (reuses
// GET /api/leader/role-assignments for the Community picker and the
// existing GET /api/leader/scoped-people endpoint — already scoped
// server-side to the Leader's own exact roles — for the member picker).
// No global member directory is ever exposed here.
export function StartPrivateMessage() {
  const { t } = useTranslation();
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [recipient, setRecipient] = useState<{ id: string; name: string } | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        setCommunities(
          res.items
            .filter((r): r is RoleAssignmentItem & { community: { id: string; name: string } } => Boolean(r.community))
            .map((r) => r.community),
        );
      })
      .catch(() => setCommunities([]));
  }, []);

  function pickRecipient(person: { id: string; name: string }) {
    setRecipient(person);
    setSentMessage(null);
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || !recipient || sending) return;
    setSending(true);
    setSendError(null);
    setSentMessage(null);
    try {
      await api.post('/api/leader/private-messages/conversations', { personIds: [recipient.id], body: trimmed });
      // Deliberately keeps `recipient` set (rather than clearing it) so this
      // success message — rendered inside the same `{recipient && (...)}`
      // block as the composer — actually stays visible to the Leader; the
      // Leader can still send another message to the same Person, or pick a
      // different Community/member to start over.
      setSentMessage(t('leaderPrivateMessages.sent_success'));
      setBody('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('leaderPrivateMessages.send_failed'));
    } finally {
      setSending(false);
    }
  }

  if (communities.length === 0) {
    return (
      <div className="card mt-6">
        <h2 className="mb-2 font-semibold text-brand-900">{t('leaderPrivateMessages.title')}</h2>
        <p className="text-sm text-slate-400">{t('leaderPrivateMessages.no_communities')}</p>
      </div>
    );
  }

  return (
    <div className="card mt-6 space-y-3">
      <h2 className="font-semibold text-brand-900">{t('leaderPrivateMessages.title')}</h2>

      <div>
        <label className="label">{t('leaderPrivateMessages.community_label')}</label>
        <select
          className="input"
          value={communityId}
          onChange={(e) => {
            setCommunityId(e.target.value);
            setRecipient(null);
            setSentMessage(null);
          }}
        >
          <option value="">{t('leaderPrivateMessages.select_community_placeholder')}</option>
          {communities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {communityId && !recipient && (
        <SearchPicker
          placeholder={t('leaderPrivateMessages.search_member_placeholder') ?? ''}
          searchPath={`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${communityId}&search=`}
          renderLabel={(p) => p.name}
          actionLabel={t('leaderPrivateMessages.add_recipient')}
          searchButtonLabel={t('leaderPrivateMessages.search_button')}
          onPick={(p) => pickRecipient({ id: p.id, name: p.name })}
        />
      )}

      {recipient && (
        <>
          <p className="text-sm text-slate-600">{recipient.name}</p>
          <label className="label">{t('leaderPrivateMessages.body_label')}</label>
          <textarea className="input" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          {sendError && <p className="text-sm text-red-700">{sendError}</p>}
          {sentMessage && <p className="text-sm text-green-700">{sentMessage}</p>}
          <button className="btn-primary" disabled={sending || !body.trim()} onClick={send}>
            {sending ? t('leaderPrivateMessages.sending') : t('leaderPrivateMessages.send')}
          </button>
        </>
      )}
    </div>
  );
}
