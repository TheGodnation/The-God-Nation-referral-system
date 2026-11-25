import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';

interface Row {
  personId: string;
  name: string;
  photoUrl: string | null;
  on: boolean;
  phones: number;
  isYou: boolean;
}
interface Data {
  total: number;
  on: number;
  members: Row[];
}

const FIRST_SHOWN = 20;

// For the group's administrator, on the group info page: how many members have notifications on, who has not turned them on yet (so
// they can be asked to), and a test alert to send to one member, to check together that it reaches their phone. Hidden for everyone else.
export function GroupNotifications({ communityId }: { communityId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<'off' | 'on' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api
      .get<Data>(`/api/communities/${communityId}/conversation/notifications`)
      .then((d) => alive && Array.isArray(d?.members) && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [communityId]);

  if (!data) return null;
  const off = data.members.filter((m) => !m.on);
  const on = data.members.filter((m) => m.on);
  const list = open === 'off' ? off : open === 'on' ? on : [];
  const shown = showAll ? list : list.slice(0, FIRST_SHOWN);

  async function test(m: Row) {
    setResults((r) => ({ ...r, [m.personId]: t('groupNotifications.sending') }));
    try {
      const res = await api.post<{ devices: number; sent: number }>(`/api/communities/${communityId}/conversation/notifications/test`, { personId: m.personId });
      setResults((r) => ({ ...r, [m.personId]: res.sent > 0 ? t('groupNotifications.test_sent', { count: res.sent }) : t('groupNotifications.test_none') }));
    } catch (e) {
      setResults((r) => ({ ...r, [m.personId]: e instanceof ApiError ? e.message : t('groupNotifications.test_failed') }));
    }
  }

  return (
    <section className="bg-white px-4 py-4 shadow-sm sm:rounded-xl" data-testid="group-notifications">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-700">🔔 {t('groupNotifications.title')}</h3>
      <p className="mt-1 text-[15px] text-slate-800" data-testid="group-notifications-count">
        {t('groupNotifications.count', { on: data.on, total: data.total })}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-green-500" style={{ width: `${data.total ? Math.round((data.on / data.total) * 100) : 0}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className={`rounded-lg border px-2 py-2 text-sm font-semibold ${open === 'off' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-700'}`} onClick={() => { setOpen(open === 'off' ? null : 'off'); setShowAll(false); }} data-testid="group-notifications-off">
          {t('groupNotifications.not_yet', { count: off.length })}
        </button>
        <button type="button" className={`rounded-lg border px-2 py-2 text-sm font-semibold ${open === 'on' ? 'border-green-500 bg-green-50 text-green-900' : 'border-slate-200 text-slate-700'}`} onClick={() => { setOpen(open === 'on' ? null : 'on'); setShowAll(false); }} data-testid="group-notifications-on">
          {t('groupNotifications.turned_on', { count: on.length })}
        </button>
      </div>
      {open && (
        <>
          <p className="mt-3 text-xs text-slate-600">{open === 'off' ? t('groupNotifications.off_help') : t('groupNotifications.on_help')}</p>
          <ul className="mt-1 divide-y divide-slate-100" data-testid="group-notifications-list">
            {shown.map((m) => (
              <li key={m.personId} className="flex items-center gap-3 py-2">
                <Avatar name={m.name} photoUrl={m.photoUrl} size={36} />
                <span className="min-w-0 flex-1">
                  {m.isYou ? (
                    <span className="block truncate font-medium text-slate-900">{t('groupChat.you')}</span>
                  ) : (
                    <Link to={`/member/people/${m.personId}`} className="block truncate font-medium text-slate-900 hover:underline">{m.name}</Link>
                  )}
                  {results[m.personId] && <span className="block text-xs text-slate-600" data-testid="group-notifications-result">{results[m.personId]}</span>}
                </span>
                {m.on && (
                  <button type="button" className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200" onClick={() => void test(m)} data-testid="group-notifications-test">
                    {t('groupNotifications.send_test')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {list.length > shown.length && (
            <button type="button" className="mt-1 text-sm font-semibold text-brand-700" onClick={() => setShowAll(true)}>
              {t('groupInfo.show_all', { count: list.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
