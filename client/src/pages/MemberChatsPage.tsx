import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { InstallAppBanner } from '../components/member/InstallAppBanner';
import { Avatar } from '../components/Avatar';
import { PrivateChatList, chatListTime } from '../components/chat/PrivateChatList';
import { mediaKind } from '../components/chat/types';
import { Announcements } from '../components/Announcements';
import { api } from '../lib/api';

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface GroupMeta {
  unreadCount: number;
  name?: string | null;
  photoUrl?: string | null;
  lastMessage?: {
    senderName: string;
    isOwn: boolean;
    body: string | null;
    deleted: boolean;
    deletedBySender?: boolean;
    attachmentMimeType: string | null;
    createdAt: string;
  } | null;
  /** 🔕 Muted by this member: grey badge, no green. */
  muted?: boolean;
}

// One group in the Chats list, WhatsApp-style: its picture, its name, the
// last message ("Grace: Amen 🙏") with the time, and the number of new ones.
function GroupRow({ m }: { m: MembershipRow }) {
  const { t, i18n } = useTranslation();
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  useEffect(() => {
    api
      .get<GroupMeta>(`/api/communities/${m.communityId}/conversation`)
      .then(setMeta)
      .catch(() => {});
  }, [m.communityId]);
  const unread = meta?.unreadCount ?? 0;
  const muted = Boolean(meta?.muted);
  const last = meta?.lastMessage;
  const deletedText = last?.deletedBySender ? (last.isOwn ? t('chatActions.you_deleted') : t('chatActions.deleted')) : t('groupChat.removed');
  const kind = mediaKind(last?.attachmentMimeType);
  const media =
    kind === 'photo'
      ? `📷 ${t('groupChat.photo')}`
      : kind === 'video'
        ? `🎥 ${t('groupChat.video')}`
        : kind === 'voice'
          ? `🎤 ${t('groupChat.voice')}`
          : kind === 'document'
            ? `📄 ${t('groupChat.document_label')}`
            : '';
  const preview = !last
    ? t('groupChat.tap_to_open')
    : `${last.isOwn ? t('groupChat.you') : last.senderName.split(' ')[0]}: ${last.deleted ? `🚫 ${deletedText}` : last.body || media}`;
  return (
    <li>
      <Link to={`/member/chats/group/${m.communityId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <Avatar name={m.communityName} photoUrl={meta?.photoUrl} size={52} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold text-slate-900">{meta?.name || m.communityName}</span>
            {last && (
              <span className={`shrink-0 text-xs ${unread > 0 && !muted ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>
                {chatListTime(last.createdAt, i18n.language)}
              </span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${unread > 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{preview}</span>
            <span className="flex shrink-0 items-center gap-1">
              {muted && (
                <span role="img" aria-label={t('chatActions.muted') ?? ''} className="text-sm text-slate-400">
                  🔕
                </span>
              )}
              {unread > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${muted ? 'bg-slate-400' : 'bg-emerald-600'}`}
                  aria-label={t('groupChat.unread', { count: unread }) ?? ''}
                >
                  {unread}
                </span>
              )}
            </span>
          </span>
        </span>
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
