import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatComposer, type OutgoingMessage } from '../components/chat/ChatComposer';
import { REACTIONS, type ChatMessage, type ChatReaction } from '../components/chat/types';

interface MessagesResponse {
  items: ChatMessage[];
  hasMore: boolean;
  unreadCount: number;
  isAdministrator: boolean;
  canPost: boolean;
  memberCount?: number;
  onlineCount?: number;
  typing?: string[];
}

interface InfoPerson {
  personId: string;
  name: string;
  photoUrl: string | null;
}

interface MessageInfo {
  status: 'sent' | 'delivered' | 'read';
  total: number;
  readBy: InfoPerson[];
  deliveredTo: InfoPerson[];
}

const POLL_MS = 8000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Puts a fresh page of the newest messages together with what we already
 * have (older pages the member scrolled up to stay in place). */
function mergeLatest(prev: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const pending = prev.filter((m) => m.pending);
  if (latest.length === 0) return pending;
  const ids = new Set(latest.map((m) => m.id));
  const oldestLatest = latest[0].createdAt;
  const older = prev.filter((m) => !m.pending && !ids.has(m.id) && m.createdAt < oldestLatest);
  return [...older, ...latest, ...pending];
}

const TIP_KEY = 'chatTipSeen';

/** A one-time hint so people discover swipe-to-reply and hold-to-react. */
function ChatTip() {
  const { t } = useTranslation();
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!show) return null;
  return (
    <div className="mx-auto mb-3 flex max-w-sm items-start gap-2 rounded-lg bg-[#fff5c4] px-3 py-2 text-xs text-slate-700 shadow-sm" role="note">
      <span className="flex-1">💡 {t('groupChat.tip')}</span>
      <button
        type="button"
        className="font-semibold text-slate-600"
        aria-label={t('groupChat.tip_close') ?? ''}
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(TIP_KEY, '1');
          } catch {
            /* ignore */
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}

// The WhatsApp-style group chat screen: full screen, bubbles, swipe to
// reply, hold for reactions, photos/videos/voice notes inline. New messages
// are checked every few seconds while the screen is open.
export function MemberGroupChatPage() {
  const { t } = useTranslation();
  const { communityId = '' } = useParams();
  const [groupName, setGroupName] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notAllowed, setNotAllowed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [canPost, setCanPost] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ members: number; online: number } | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [info, setInfo] = useState<{ message: ChatMessage; data: MessageInfo | null } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffsetFromBottom = useRef<number | null>(null);
  const lastReadId = useRef<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: { communityId: string; communityName: string }[] }>('/api/member/me/community-memberships')
      .then((r) => setGroupName(r.items.find((m) => m.communityId === communityId)?.communityName ?? ''))
      .catch(() => {});
  }, [communityId]);

  function markRead(items: ChatMessage[], unread: number) {
    const latest = items[items.length - 1];
    if (!latest || unread === 0 || lastReadId.current === latest.id) return;
    lastReadId.current = latest.id;
    api.post(`/api/communities/${communityId}/conversation/read`, { messageId: latest.id }).catch(() => {});
  }

  const fetchLatest = useCallback(
    (first = false) => {
      return api
        .get<MessagesResponse>(`/api/communities/${communityId}/conversation/messages`)
        .then((res) => {
          setMessages((prev) => (first ? res.items : mergeLatest(prev, res.items)));
          if (first) setHasMore(res.hasMore);
          setIsAdministrator(res.isAdministrator);
          if (typeof res.memberCount === 'number') setCounts({ members: res.memberCount, online: res.onlineCount ?? 0 });
          setTypingNames(res.typing ?? []);
          setCanPost(res.canPost !== false);
          setLoadError(false);
          markRead(res.items, res.unreadCount);
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setNotAllowed(true);
          else if (first) setLoadError(true);
        })
        .finally(() => first && setLoaded(true));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityId],
  );

  useEffect(() => {
    stickToBottom.current = true;
    void fetchLatest(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchLatest(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchLatest]);

  // Keep the view at the bottom for new messages, and in place when older
  // messages are added above.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (keepOffsetFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffsetFromBottom.current;
      keepOffsetFromBottom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    const first = messages.find((m) => !m.pending);
    if (!first) return;
    setLoadingOlder(true);
    api
      .get<MessagesResponse>(`/api/communities/${communityId}/conversation/messages?before=${first.id}`)
      .then((res) => {
        const el = scrollRef.current;
        if (el) keepOffsetFromBottom.current = el.scrollHeight - el.scrollTop;
        setMessages((prev) => [...res.items.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
        setHasMore(res.hasMore);
      })
      .catch(() => setToast(t('groupChat.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 3500);
  }

  async function send(out: OutgoingMessage): Promise<boolean> {
    const tempId = `pending-${Date.now()}`;
    const reply = replyTo;
    const temp: ChatMessage = {
      id: tempId,
      senderName: t('groupChat.you'),
      isOwn: true,
      body: out.body ?? null,
      createdAt: new Date().toISOString(),
      deleted: false,
      attachments: [],
      pending: true,
      replyTo: reply
        ? {
            id: reply.id,
            senderName: reply.senderName,
            body: reply.body,
            deleted: reply.deleted,
            attachmentMimeType: reply.attachments[0]?.mimeType ?? null,
          }
        : null,
    };
    stickToBottom.current = true;
    setMessages((prev) => [...prev, temp]);
    setReplyTo(null);
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages`, out);
      await fetchLatest(false);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return true;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setReplyTo(reply);
      if (err instanceof ApiError && err.status === 503) showToast(t('groupChat.storage_off'));
      else if (err instanceof ApiError && err.status === 403) showToast(t('groupChat.only_leaders'));
      else showToast(t('groupChat.send_failed'));
      return false;
    }
  }

  function setReactions(messageId: string, reactions: ChatReaction[]) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  }

  async function react(m: ChatMessage, emoji: string) {
    setMenuFor(null);
    const mine = (m.reactions ?? []).find((r) => r.mine);
    try {
      const res =
        mine?.emoji === emoji
          ? await api.delete<{ reactions: ChatReaction[] }>(`/api/communities/${communityId}/conversation/messages/${m.id}/reaction`)
          : await api.put<{ reactions: ChatReaction[] }>(`/api/communities/${communityId}/conversation/messages/${m.id}/reaction`, { emoji });
      setReactions(m.id, res.reactions);
    } catch {
      showToast(t('groupChat.action_failed'));
    }
  }

  async function copy(m: ChatMessage) {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(m.body ?? '');
      showToast(t('groupChat.copied'));
    } catch {
      /* clipboard not available */
    }
  }

  async function openInfo(m: ChatMessage) {
    setMenuFor(null);
    setInfo({ message: m, data: null });
    try {
      const data = await api.get<MessageInfo>(`/api/communities/${communityId}/conversation/messages/${m.id}/info`);
      setInfo((cur) => (cur && cur.message.id === m.id ? { message: m, data } : cur));
    } catch {
      setInfo(null);
      showToast(t('groupChat.action_failed'));
    }
  }

  async function hideForMe(m: ChatMessage) {
    setMenuFor(null);
    if (!window.confirm(t('groupChat.hide_confirm') ?? '')) return;
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages/${m.id}/hide`);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch {
      showToast(t('groupChat.action_failed'));
    }
  }

  async function removeForAll(m: ChatMessage) {
    setMenuFor(null);
    if (!window.confirm(t('groupChat.remove_confirm') ?? '')) return;
    try {
      await api.delete(`/api/communities/${communityId}/conversation/messages/${m.id}`);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, attachments: [], reactions: [], replyTo: null } : x)));
    } catch {
      showToast(t('groupChat.action_failed'));
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      showToast(t('groupChat.not_loaded'));
      return;
    }
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
  }

  function dayLabel(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) return t('groupChat.today');
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('groupChat.yesterday');
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#efeae2]">
      <header className="flex items-center gap-3 bg-brand-800 px-2 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-white shadow">
        <Link to="/member/chats" aria-label={t('groupChat.back') ?? ''} className="px-2 text-2xl leading-none">
          ←
        </Link>
        <Avatar name={groupName || '?'} size={40} />
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{groupName || t('groupChat.group')}</h1>
          <p className={`truncate text-xs ${typingNames.length ? 'font-semibold text-emerald-300' : 'text-white/70'}`}>
            {typingNames.length === 1
              ? t('groupChat.typing_one', { name: typingNames[0] })
              : typingNames.length > 1
                ? t('groupChat.typing_many', { count: typingNames.length })
                : counts
                  ? t('groupChat.members_online', { members: counts.members, online: counts.online })
                  : t('groupChat.subtitle')}
          </p>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-2 py-3" aria-live="polite">
        {!loaded && <p className="mt-10 text-center text-sm text-slate-500">{t('groupChat.loading')}</p>}
        {notAllowed && <p className="mx-auto mt-10 max-w-xs rounded-lg bg-white p-4 text-center text-sm text-slate-600">{t('groupChat.not_allowed')}</p>}
        {loadError && !notAllowed && (
          <div className="mx-auto mt-10 max-w-xs rounded-lg bg-white p-4 text-center text-sm">
            <p className="text-red-700">{t('groupChat.load_failed')}</p>
            <button type="button" className="mt-2 text-brand-700 underline" onClick={() => void fetchLatest(true)}>
              {t('groupChat.try_again')}
            </button>
          </div>
        )}

        {hasMore && (
          <div className="mb-3 text-center">
            <button type="button" onClick={loadOlder} disabled={loadingOlder} className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow">
              {loadingOlder ? t('groupChat.loading') : t('groupChat.load_older')}
            </button>
          </div>
        )}

        {loaded && !loadError && !notAllowed && messages.length === 0 && (
          <p className="mx-auto mt-10 max-w-xs rounded-lg bg-[#fff5c4] p-3 text-center text-sm text-slate-700">{t('groupChat.empty')}</p>
        )}

        {loaded && messages.length > 0 && <ChatTip />}

        <div className="space-y-1">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const showSender = newDay || !prev || prev.senderName !== m.senderName || prev.isOwn !== m.isOwn;
            return (
              <div key={m.id} className={showSender && !newDay ? 'pt-2' : ''}>
                {newDay && (
                  <div className="my-3 text-center">
                    <span className="rounded-md bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                <MessageBubble
                  m={m}
                  mediaBase={`/api/communities/${communityId}/conversation`}
                  showSender={showSender}
                  highlighted={highlightId === m.id}
                  onReply={setReplyTo}
                  onMenu={setMenuFor}
                  onReact={react}
                  onJumpTo={jumpTo}
                  onOpenPhoto={setPhotoUrl}
                />
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          <span className="rounded-full bg-slate-800/90 px-4 py-2 text-sm text-white">{toast}</span>
        </div>
      )}

      {!notAllowed &&
        (canPost ? (
          <ChatComposer
            uploadPath={`/api/communities/${communityId}/attachments/authorize`}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSend={send}
            onTyping={(typing) => void api.post(`/api/communities/${communityId}/conversation/typing`, { typing }).catch(() => {})}
          />
        ) : (
          <p className="bg-[#f0f2f5] px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 text-center text-sm text-slate-600">{t('groupChat.only_leaders')}</p>
        ))}

      {menuFor && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={() => setMenuFor(null)}>
          <div
            role="dialog"
            aria-label={t('groupChat.options') ?? ''}
            className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex justify-around rounded-full bg-slate-100 py-2 text-2xl">
              {REACTIONS.map((emoji) => {
                const mine = (menuFor.reactions ?? []).some((r) => r.mine && r.emoji === emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => void react(menuFor, emoji)}
                    aria-label={t('groupChat.react_with', { emoji }) ?? ''}
                    aria-pressed={mine}
                    className={`rounded-full px-1.5 transition-transform active:scale-125 ${mine ? 'bg-emerald-100' : ''}`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
            <div className="divide-y divide-slate-100 text-[15px]">
              {canPost && (
                <button
                  type="button"
                  className="block w-full py-3 text-left"
                  onClick={() => {
                    setReplyTo(menuFor);
                    setMenuFor(null);
                  }}
                >
                  ↩️ {t('groupChat.reply')}
                </button>
              )}
              {menuFor.body && (
                <button type="button" className="block w-full py-3 text-left" onClick={() => void copy(menuFor)}>
                  📋 {t('groupChat.copy')}
                </button>
              )}
              {menuFor.isOwn && (
                <button type="button" className="block w-full py-3 text-left" onClick={() => void openInfo(menuFor)}>
                  ℹ️ {t('groupChat.message_info')}
                </button>
              )}
              {menuFor.isOwn && (
                <button type="button" className="block w-full py-3 text-left" onClick={() => void hideForMe(menuFor)}>
                  🗑️ {t('groupChat.delete_for_me')}
                </button>
              )}
              {isAdministrator && (
                <button type="button" className="block w-full py-3 text-left text-red-700" onClick={() => void removeForAll(menuFor)}>
                  🚫 {t('groupChat.remove_all')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {info && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={() => setInfo(null)}>
          <div
            role="dialog"
            aria-label={t('groupChat.message_info') ?? ''}
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 font-semibold text-slate-900">ℹ️ {t('groupChat.message_info')}</h2>
            {info.message.body && <p className="mb-3 line-clamp-3 rounded-lg bg-[#dcf8c6] px-3 py-2 text-sm">{info.message.body}</p>}
            {!info.data ? (
              <p className="text-sm text-slate-500">{t('groupChat.loading')}</p>
            ) : (
              <>
                <p className="mb-2 text-sm font-semibold text-sky-600">
                  ✓✓ {t('groupChat.seen_by', { count: info.data.readBy.length, total: info.data.total })}
                </p>
                <ul className="mb-4 space-y-2">
                  {info.data.readBy.map((p) => (
                    <li key={p.personId} className="flex items-center gap-2 text-sm">
                      <Avatar name={p.name} photoUrl={p.photoUrl} size={28} />
                      {p.name}
                    </li>
                  ))}
                </ul>
                {info.data.deliveredTo.length > 0 && (
                  <>
                    <p className="mb-2 text-sm font-semibold text-slate-500">
                      ✓✓ {t('groupChat.delivered_to', { count: info.data.deliveredTo.length })}
                    </p>
                    <ul className="space-y-2">
                      {info.data.deliveredTo.map((p) => (
                        <li key={p.personId} className="flex items-center gap-2 text-sm text-slate-600">
                          <Avatar name={p.name} photoUrl={p.photoUrl} size={28} />
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {photoUrl && (
        <div role="dialog" aria-label={t('groupChat.photo') ?? ''} className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex justify-end p-3">
            <button type="button" onClick={() => setPhotoUrl(null)} aria-label={t('groupChat.close') ?? ''} className="text-2xl text-white">
              ✕
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto">
            <img src={photoUrl} alt={t('groupChat.photo') ?? ''} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
