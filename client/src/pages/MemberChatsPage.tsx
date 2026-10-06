import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { InstallAppBanner } from '../components/member/InstallAppBanner';
import { Avatar } from '../components/Avatar';
import { PrivateChatList } from '../components/chat/PrivateChatList';
import { Announcements } from '../components/Announcements';
import { api } from '../lib/api';

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function GroupRow({ m }: { m: MembershipRow }) {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api
      .get<{ unreadCount: number }>(`/api/communities/${m.communityId}/conversation`)
      .then((r) => setUnread(r.unreadCount))
      .catch(() => {});
  }, [m.communityId]);
  return (
    <li>
      <Link to={`/member/chats/group/${m.communityId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <Avatar name={m.communityName} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-900">{m.communityName}</span>
          <span className="block truncate text-sm text-slate-500">{t('groupChat.tap_to_open')}</span>
        </span>
        {unread > 0 && (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white" aria-label={t('groupChat.unread', { count: unread }) ?? ''}>
            {unread}
          </span>
        )}
      </Link>
    </li>
  );
}

// "Chats": the member's group chat(s) as WhatsApp-style rows (tap to open
// the full chat screen), then announcements and private messages.
export function MemberChatsPage() {
  const { t } = useTranslation();
  const [memberships, setMemberships] = useState<MembershipRow[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: MembershipRow[] }>('/api/member/me/community-memberships')
      .then((r) => setMemberships(r.items))
      .catch(() => setMemberships([]));
  }, []);

  const active = memberships?.filter((m) => m.status === 'ACTIVE') ?? [];

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('memberNav.chats')}</h1>
          <NotificationBell />
        </div>
        <InstallAppBanner />
        <div className="space-y-6">
          <section className="card p-0">
            <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('groupChat.groups')}</h2>
            {memberships === null && <p className="px-4 py-3 text-sm text-slate-400">{t('memberDashboard.loading')}</p>}
            {memberships !== null && active.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{t('memberDashboard.no_memberships')}</p>}
            <ul className="divide-y divide-slate-100">
              {active.map((m) => (
                <GroupRow key={m.communityId} m={m} />
              ))}
            </ul>
          </section>
          <PrivateChatList />
          <Announcements />
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
