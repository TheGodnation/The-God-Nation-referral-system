import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError, NetworkError } from '../lib/api';
import { appendNew, applyRecent, lastServerId, useAdaptivePoll, useOutbox, type RecentChange } from '../lib/chatSync';
import { Avatar } from '../components/Avatar';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatComposer, type OutgoingMessage } from '../components/chat/ChatComposer';
import { REACTIONS, type ChatAttachment, type ChatMessage, type ChatReaction } from '../components/chat/types';

interface PrivateRow {
  id: string;
  isOwn: boolean;
  body: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  replyTo?: { id: string; isOwn: boolean; body: string; attachmentMimeType: string | null } | null;
  reactions?: ChatReaction[];
  status?: 'sent' | 'delivered' | 'read';
}

interface PrivateResponse {
  items: PrivateRow[];
  hasMore: boolean;
  newerOverflow?: boolean;
  recent?: RecentChange[];
  unreadCount: number;
  otherPartyType: 'CENTRAL_AUTHORITY' | 'LEADER' | 'MEMBER';
  otherPartyName?: string | null;
  otherPartyPersonId?: string;
  otherPartyPhotoUrl?: string | null;
  otherPartyPresence?: { online: boolean; lastSeenAt: string | null } | null;
  typing?: boolean;
}

const POLL_MS = 5000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function mergeLatest(prev: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const pending = prev.filter((m) => m.pending);
  if (latest.length === 0) return pending;
  const ids = new Set(latest.map((m) => m.id));
  const oldest = latest[0].createdAt;
  const older = prev.filter((m) => !m.pending && !ids.has(m.id) && m.createdAt < oldest);
  return [...older, ...latest, ...pending];
}

// A one-to-one chat, WhatsApp-style: the other person's photo and name at
// the top, bubbles, swipe to reply, hold to react, voice notes, photos,
// videos and documents. New messages show up every few seconds.
export function MemberPrivateChatPage() {
  const { t } = useTranslation();
  const { conversationId = '' } = useParams();
  const base = `/api/private-messages/conversations/${conversationId}`;

  const [other, setOther] = useState<Pick<PrivateResponse, 'otherPartyType' | 'otherPartyName' | 'otherPartyPersonId' | 'otherPartyPhotoUrl'> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [presence, setPresence] = useState<PrivateResponse['otherPartyPresence']>(null);
  const [otherTyping, setOtherTyping] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffsetFromBottom = useRef<number | null>(null);
  const lastReadId = useRef<string | null>(null);
  const otherNameRef = useRef('');

  const otherName =
    other?.otherPartyType === 'CENTRAL_AUTHORITY' ? t('privateChat.headquarters') : other?.otherPartyName || t('privateChat.someone');
  otherNameRef.current = otherName;

  const toChat = useCallback(
    (r: PrivateRow): ChatMessage => ({
      id: r.id,
      senderName: r.isOwn ? t('groupChat.you') : otherNameRef.current,
      isOwn: r.isOwn,
      body: r.body || null,
      createdAt: r.createdAt,
      deleted: false,
      attachments: r.attachments ?? [],
      reactions: r.reactions ?? [],
      status: r.status,
      replyTo: r.replyTo
        ? {
            id: r.replyTo.id,
            senderName: r.replyTo.isOwn ? t('groupChat.you') : otherNameRef.current,
            body: r.replyTo.body || null,
            deleted: false,
            attachmentMimeType: r.replyTo.attachmentMimeType,
          }
        : null,
    }),
    [t],
  );

  function markRead(items: PrivateRow[], unread: number) {
    const latest = items[items.length - 1];
    if (!latest || unread === 0 || lastReadId.current === latest.id) return;
    lastReadId.current = latest.id;
    api.post(`${base}/read`, { messageId: latest.id }).catch(() => {});
  }

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const pokeRef = useRef<() => void>(() => {});

  // Messages typed while offline: shown with 🕓, sent when the network is back.
  const outbox = useOutbox(
    `private:${conversationId}`,
    (out) => api.post(`${base}/messages`, out).then(() => undefined),
    (tempId) => {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      pokeRef.current();
    },
    (tempId) => {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      showToast(t('groupChat.send_failed'));
    },
  );
  const queuedRef = useRef(outbox.queued);
  queuedRef.current = outbox.queued;

  // First load: the latest page. After that, only what is new.
  const fetchLatest = useCallback(
    (first = false): Promise<boolean> => {
      const lastId = first ? null : lastServerId(messagesRef.current);
      return api
        .get<PrivateResponse>(`${base}/messages${lastId ? `?after=${encodeURIComponent(lastId)}` : ''}`)
        .then((res): boolean | Promise<boolean> => {
          if (lastId && res.newerOverflow) return fetchLatest(true);
          setOther({
            otherPartyType: res.otherPartyType,
            otherPartyName: res.otherPartyName,
            otherPartyPersonId: res.otherPartyPersonId,
            otherPartyPhotoUrl: res.otherPartyPhotoUrl,
          });
          setPresence(res.otherPartyPresence ?? null);
          setOtherTyping(Boolean(res.typing));
          if (res.otherPartyType === 'CENTRAL_AUTHORITY') otherNameRef.current = t('privateChat.headquarters');
          else otherNameRef.current = res.otherPartyName || t('privateChat.someone');
          const items = res.items.map(toChat);
          setMessages((prev) => {
            if (first) {
              const queued = queuedRef.current.map((q) => q.message).filter((q) => !prev.some((m) => m.id === q.id));
              return [...items, ...queued];
            }
            return lastId ? applyRecent(appendNew(prev, items), res.recent) : mergeLatest(prev, items);
          });
          if (first) setHasMore(res.hasMore);
          setLoadError(false);
          markRead(res.items, res.unreadCount);
          return items.length > 0 || Boolean(res.typing);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else if (first) setLoadError(true);
          return false;
        })
        .finally(() => first && setLoaded(true));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, toChat],
  );

  useEffect(() => {
    stickToBottom.current = true;
    void fetchLatest(true);
  }, [fetchLatest]);

  // Checks every few seconds while chatting, up to every 30 s when quiet.
  const poke = useAdaptivePoll(() => fetchLatest(false), POLL_MS, loaded && !notFound);
  pokeRef.current = poke;

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
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function loadOlder() {
    const first = messages.find((m) => !m.pending);
    if (loadingOlder || !first) return;
    setLoadingOlder(true);
    api
      .get<PrivateResponse>(`${base}/messages?before=${first.id}`)
      .then((res) => {
        const el = scrollRef.current;
        if (el) keepOffsetFromBottom.current = el.scrollHeight - el.scrollTop;
        const older = res.items.map(toChat);
        setMessages((prev) => [...older.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
        setHasMore(res.hasMore);
      })
      .catch(() => showToast(t('groupChat.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 3500);
  }

  async function send(out: OutgoingMessage): Promise<boolean> {
    const tempId = `pending-${Date.now()}`;
    const reply = replyTo;
    stickToBottom.current = true;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        senderName: t('groupChat.you'),
        isOwn: true,
        body: out.body ?? null,
        createdAt: new Date().toISOString(),
        deleted: false,
        attachments: [],
        pending: true,
        replyTo: reply
          ? { id: reply.id, senderName: reply.senderName, body: reply.body, deleted: false, attachmentMimeType: reply.attachments[0]?.mimeType ?? null }
          : null,
      },
    ]);
    setReplyTo(null);
    try {
      await api.post(`${base}/messages`, out);
      await fetchLatest(false);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      poke();
      return true;
    } catch (err) {
      if (err instanceof NetworkError) {
        // No network: keep it with a 🕓 and send it when the network is back.
        const temp: ChatMessage = messagesRef.current.find((m) => m.id === tempId) ?? {
          id: tempId,
          senderName: t('groupChat.you'),
          isOwn: true,
          body: out.body ?? null,
          createdAt: new Date().toISOString(),
          deleted: false,
          attachments: [],
          pending: true,
        };
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, queued: true } : m)));
        outbox.enqueue(tempId, out, temp);
        return true;
      }
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setReplyTo(reply);
      if (err instanceof ApiError && err.status === 503) showToast(t('groupChat.storage_off'));
      else if (err instanceof ApiError && err.status === 403) showToast(t('privateChat.blocked'));
      else showToast(t('groupChat.send_failed'));
      return false;
    }
  }

  async function react(m: ChatMessage, emoji: string) {
    setMenuFor(null);
    const mine = (m.reactions ?? []).find((r) => r.mine);
    try {
      const res =
        mine?.emoji === emoji
          ? await api.delete<{ reactions: ChatReaction[] }>(`${base}/messages/${m.id}/reaction`)
          : await api.put<{ reactions: ChatReaction[] }>(`${base}/messages/${m.id}/reaction`, { emoji });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
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
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) return t('groupChat.today');
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('groupChat.yesterday');
    return new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function lastSeenText(iso: string) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dayKey(iso) === dayKey(new Date().toISOString())) return t('privateChat.last_seen_today', { time });
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('privateChat.last_seen_yesterday', { time });
    return t('privateChat.last_seen_date', { date: d.toLocaleDateString([], { day: 'numeric', month: 'short' }), time });
  }

  const roleLabel =
    other?.otherPartyType === 'CENTRAL_AUTHORITY'
      ? t('privateChat.official')
      : other?.otherPartyType === 'LEADER'
        ? t('privateChat.leader')
        : t('privateChat.member');
  const subtitle = otherTyping
    ? t('privateChat.typing')
    : presence?.online
      ? t('privateChat.online')
      : presence?.lastSeenAt
        ? lastSeenText(presence.lastSeenAt)
        : roleLabel;

  const headerInner = (
    <>
      {other?.otherPartyType === 'CENTRAL_AUTHORITY' ? (
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-full bg-white object-contain p-0.5" />
      ) : (
        <Avatar name={otherName} photoUrl={other?.otherPartyPhotoUrl} size={40} />
      )}
      <span className="min-w-0">
        <h1 className="truncate font-semibold">{other ? otherName : t('groupChat.loading')}</h1>
        {other && (
          <p className={`truncate text-xs ${otherTyping || presence?.online ? 'font-semibold text-emerald-300' : 'text-white/70'}`}>{subtitle}</p>
        )}
      </span>
    </>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-[#efeae2]">
      <header className="flex items-center gap-3 bg-brand-800 px-2 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-white shadow">
        <Link to="/member/chats" aria-label={t('groupChat.back') ?? ''} className="px-2 text-2xl leading-none">
          ←
        </Link>
        {other?.otherPartyPersonId ? (
          <Link to={`/member/people/${other.otherPartyPersonId}`} className="flex min-w-0 items-center gap-3">
            {headerInner}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-3">{headerInner}</div>
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-2 py-3" aria-live="polite">
        {!loaded && <p className="mt-10 text-center text-sm text-slate-500">{t('groupChat.loading')}</p>}
        {notFound && <p className="mx-auto mt-10 max-w-xs rounded-lg bg-white p-4 text-center text-sm text-slate-600">{t('privateChat.not_found')}</p>}
        {loadError && !notFound && (
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
        {loaded && !loadError && !notFound && messages.length === 0 && (
          <p className="mx-auto mt-10 max-w-xs rounded-lg bg-[#fff5c4] p-3 text-center text-sm text-slate-700">
            {t('privateChat.empty', { name: otherName })}
          </p>
        )}

        <div className="space-y-1">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const gap = prev && !newDay && prev.isOwn !== m.isOwn;
            return (
              <div key={m.id} className={gap ? 'pt-2' : ''}>
                {newDay && (
                  <div className="my-3 text-center">
                    <span className="rounded-md bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                <MessageBubble
                  m={m}
                  mediaBase={base}
                  showSender={false}
                  privateChat
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

      {!notFound && (
        <ChatComposer
          uploadPath={`${base}/attachments/authorize`}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
          onTyping={(typing) => void api.post(`${base}/typing`, { typing }).catch(() => {})}
        />
      )}

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
              {menuFor.body && (
                <button type="button" className="block w-full py-3 text-left" onClick={() => void copy(menuFor)}>
                  📋 {t('groupChat.copy')}
                </button>
              )}
            </div>
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
