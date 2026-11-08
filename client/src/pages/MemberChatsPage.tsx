import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { InstallAppBanner } from '../components/member/InstallAppBanner';
import { AssistanceButton } from '../components/member/AssistanceButton';
import { EnableNotificationsBanner } from '../components/member/EnableNotificationsBanner';
import { Avatar } from '../components/Avatar';
import { PaymentDeskCard } from '../components/member/PaymentDeskCard';
import { EventsCard } from '../components/member/EventsCard';
import { LeadershipCard } from '../components/member/LeadershipCard';
import { PrivateChatList, chatListTime } from '../components/chat/PrivateChatList';
import { mediaKind } from '../components/chat/types';
import { Announcements } from '../components/Announcements';
import { api } from '../lib/api';
import { DraftPreview, useChatDraft } from '../components/chat/DraftTag';
import { plainPreview } from '../lib/richText';

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
  /** 0 = Headquarters, 1 = directly under it, … (null = outside the tree). */
  generation?: number | null;
  /** Opened by the National Coordinator without being a member there. */
  asCoordinator?: boolean;
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
}

// One group in the Chats list, WhatsApp-style: its picture, its name, the
// last message ("Grace: Amen 🙏") with the time, and the number of new ones.
function GroupRow({ m, onUnread }: { m: MembershipRow; onUnread?: (communityId: string, count: number) => void }) {
  const { t, i18n } = useTranslation();
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<GroupMeta>(`/api/communities/${m.communityId}/conversation`)
        .then((r) => alive && setMeta(r))
        .catch(() => {});
    load();
    // New messages show up without reopening the page (rows never move; only the preview and number change).
    const timer = window.setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [m.communityId]);
  const unread = meta?.unreadCount ?? 0;
  useEffect(() => {
    if (meta) onUnread?.(m.communityId, unread);
  }, [meta, unread, m.communityId, onUnread]);
  const draft = useChatDraft(`group:${m.communityId}`);
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
    : `${last.isOwn ? t('groupChat.you') : last.senderName.split(' ')[0]}: ${last.deleted ? `🚫 ${deletedText}` : plainPreview(last.body) || media}`;
  return (
    <li>
      <Link to={`/member/chats/group/${m.communityId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <Avatar name={m.communityName} photoUrl={meta?.photoUrl} size={52} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold text-slate-900">{meta?.name || m.communityName}</span>
            {last && (
              <span className={`shrink-0 text-xs ${unread > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>
                {chatListTime(last.createdAt, i18n.language)}
              </span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${unread > 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{draft ? <DraftPreview draft={draft} /> : preview}</span>
            <span className="flex shrink-0 items-center gap-1">
              {unread > 0 && (
                <span
                  className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white"
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

  // Fixed order, so a row is always where you expect it: the Headquarters first,
  // then each generation in turn (its name breaks ties). Messages never reorder this.
  const byPlace = (x: MembershipRow, y: MembershipRow) =>
    (x.generation ?? 999) - (y.generation ?? 999) || x.communityName.localeCompare(y.communityName);
  const active = useMemo(() => (memberships?.filter((m) => m.status === 'ACTIVE' && !m.asCoordinator) ?? []).sort(byPlace), [memberships]);
  const coordinatorOnly = useMemo(() => (memberships?.filter((m) => m.asCoordinator) ?? []).sort(byPlace), [memberships]);

  const [tab, setTab] = useState<'assemblies' | 'private'>('assemblies');
  const touched = useRef(false);
  const [groupUnread, setGroupUnread] = useState<Record<string, number>>({});
  const [privateUnread, setPrivateUnread] = useState<number | null>(null);
  const [privateChats, setPrivateChats] = useState<number | null>(null);
  const onGroupUnread = useCallback((id: string, n: number) => setGroupUnread((prev) => (prev[id] === n ? prev : { ...prev, [id]: n })), []);
  const onPrivateUnread = useCallback((n: number, chats: number) => {
    setPrivateUnread(n);
    setPrivateChats(chats);
  }, []);
  const assembliesUnread = Object.values(groupUnread).reduce((a, b) => a + b, 0);
  // The first time we know about private messages, open on them when there are new ones.
  useEffect(() => {
    if (privateUnread && privateUnread > 0 && !touched.current) setTab('private');
  }, [privateUnread]);
  const pick = (to: 'assemblies' | 'private') => {
    touched.current = true;
    setTab(to);
  };

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('memberNav.chats')}</h1>
          <NotificationBell />
        </div>
        <InstallAppBanner />
        <EnableNotificationsBanner />
        <PaymentDeskCard />
        <EventsCard />
        <LeadershipCard />
        <div role="tablist" className="mb-4 flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {(['assemblies', 'private'] as const).map((k) => {
            const n = k === 'assemblies' ? assembliesUnread : privateUnread ?? 0;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => pick(k)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 ${tab === k ? 'bg-white text-brand-900 shadow' : 'text-slate-500'}`}
              >
                {k === 'assemblies' ? t('chatsTabs.assemblies') : t('chatsTabs.private')}
                {n > 0 && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white" aria-label={t('groupChat.unread', { count: n }) ?? ''}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="space-y-6">
          <div className={tab === 'assemblies' ? 'space-y-6' : 'hidden'}>
          <section className="card p-0">
            <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('groupChat.groups')}</h2>
            {memberships === null && <p className="px-4 py-3 text-sm text-slate-400">{t('memberDashboard.loading')}</p>}
            {memberships !== null && active.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{t('memberDashboard.no_memberships')}</p>}
            <ul className="divide-y divide-slate-100">
              {active.map((m) => (
                <GroupRow key={m.communityId} m={m} onUnread={onGroupUnread} />
              ))}
            </ul>
          </section>
          {coordinatorOnly.length > 0 && (
            <section className="card p-0">
              <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-amber-800">★ {t('groupChat.all_assemblies')}</h2>
              <ul className="divide-y divide-slate-100">
                {coordinatorOnly.map((m) => (
                  <GroupRow key={m.communityId} m={m} onUnread={onGroupUnread} />
                ))}
              </ul>
            </section>
          )}
          </div>
          <div className={tab === 'private' ? '' : 'hidden'}>
            <PrivateChatList onUnread={onPrivateUnread} />
            {privateChats === 0 && <p className="px-2 text-sm text-slate-500" data-testid="private-empty-hint">{t('chatsTabs.private_hint')}</p>}
          </div>
          <Announcements />
        </div>
        <MemberNav />
        <AssistanceButton />
      </section>
    </PageShell>
  );
}
