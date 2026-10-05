import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

export type FriendStatus = 'SELF' | 'NONE' | 'FRIENDS' | 'REQUEST_SENT' | 'REQUEST_RECEIVED' | 'BLOCKED';

export interface PersonCardData {
  personId: string;
  name: string;
  photoUrl: string | null;
  area: string | null;
  friendStatus: FriendStatus;
  requestId: string | null;
  mutualFriends?: number;
}

/** Add friend / Cancel / Accept-Decline / Friends — the one friendship button. */
export function FriendButton({
  person,
  onChange,
}: {
  person: Pick<PersonCardData, 'personId' | 'friendStatus' | 'requestId'>;
  onChange: (status: FriendStatus, requestId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ friendStatus: FriendStatus; requestId?: string | null }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      onChange(res.friendStatus, res.requestId ?? null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'SAME_GROUP_ONLY' ? t('people.same_group_only') : t('people.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(() => api.post('/api/member/friends/requests', { personId: person.personId }));
  const remove = () => run(() => api.delete(`/api/member/friends/${person.personId}`));
  const accept = () => run(() => api.post(`/api/member/friends/requests/${person.requestId}/accept`));
  const decline = () => run(() => api.post(`/api/member/friends/requests/${person.requestId}/decline`));

  let buttons: ReactElement;
  switch (person.friendStatus) {
    case 'FRIENDS':
      buttons = (
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => window.confirm(t('people.confirm_unfriend') ?? '') && remove()}>
          ✓ {t('people.friends')}
        </button>
      );
      break;
    case 'REQUEST_SENT':
      buttons = (
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={remove}>
          {t('people.cancel_request')}
        </button>
      );
      break;
    case 'REQUEST_RECEIVED':
      buttons = (
        <span className="flex gap-2">
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={accept}>
            {t('people.accept')}
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={decline}>
            {t('people.decline')}
          </button>
        </span>
      );
      break;
    case 'NONE':
      buttons = (
        <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={add}>
          ＋ {t('people.add_friend')}
        </button>
      );
      break;
    default:
      return null;
  }
  return (
    <span className="flex flex-col items-end gap-1">
      {buttons}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

export function PersonCard({ person, onChange }: { person: PersonCardData; onChange?: (p: PersonCardData) => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(person);
  return (
    <li className="flex items-center gap-3 py-2">
      <Link to={`/member/people/${current.personId}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={current.name} photoUrl={current.photoUrl} size={44} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-slate-800">{current.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {[current.area, current.mutualFriends ? t('people.mutual_friends', { count: current.mutualFriends }) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </Link>
      <FriendButton
        person={current}
        onChange={(friendStatus, requestId) => {
          const next = { ...current, friendStatus, requestId };
          setCurrent(next);
          onChange?.(next);
        }}
      />
    </li>
  );
}
