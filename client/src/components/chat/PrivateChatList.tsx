import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Avatar } from '../Avatar';
import { mediaKind } from './types';
import { Ticks } from './MessageBubble';

interface ConversationRow {
  id: string;
  createdAt: string;
  otherPartyType: 'CENTRAL_AUTHORITY' | 'LEADER' | 'MEMBER';
  otherPartyName?: string | null;
  otherPartyPhotoUrl?: string | null;
  unreadCount: number;
  lastMessage?: { body: string; attachmentMimeType: string | null; isOwn: boolean; createdAt: string; status?: 'sent' | 'delivered' | 'read' } | null;
}

/** "10:45" today, "Yesterday", or a short date — like WhatsApp's chat list. */
export function chatListTime(iso: string, language: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const locale = language.startsWith('fr') ? 'fr-FR' : 'en-GB';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === yesterday.toDateString()) return language.startsWith('fr') ? 'Hier' : 'Yesterday';
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Private chats as WhatsApp-style rows: photo, name, the last message and
// its time, and the number of new messages. Newest chats on top.
export function PrivateChatList() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ConversationRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api
        .get<{ items: ConversationRow[] }>('/api/private-messages/conversations?pageSize=100')
        .then((r) => alive && setItems(r.items))
        .catch(() => alive && setItems((prev) => prev ?? []));
    }
    load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!items || items.length === 0) return null;

  const sorted = [...items].sort(
    (a, b) => new Date(b.lastMessage?.createdAt ?? b.createdAt).getTime() - new Date(a.lastMessage?.createdAt ?? a.createdAt).getTime(),
  );

  function preview(c: ConversationRow) {
    const m = c.lastMessage;
    if (!m) return t('privateChat.no_messages_yet');
    const kind = mediaKind(m.attachmentMimeType);
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
    const text = m.body || media;
    return m.isOwn ? `${t('groupChat.you')}: ${text}` : text;
  }

  return (
    <section className="card p-0">
      <h2 className="px-4 pt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('privateChat.title')}</h2>
      <ul className="divide-y divide-slate-100">
        {sorted.map((c) => {
          const name = c.otherPartyType === 'CENTRAL_AUTHORITY' ? t('privateChat.headquarters') : c.otherPartyName || t('privateChat.someone');
          return (
            <li key={c.id}>
              <Link to={`/member/chats/private/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                {c.otherPartyType === 'CENTRAL_AUTHORITY' ? (
                  <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-full border border-slate-200 object-contain p-0.5" />
                ) : (
                  <Avatar name={name} photoUrl={c.otherPartyPhotoUrl} size={48} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900">{name}</span>
                    {c.lastMessage && (
                      <span className={`shrink-0 text-xs ${c.unreadCount > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>
                        {chatListTime(c.lastMessage.createdAt, i18n.language)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${c.unreadCount > 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                      {c.lastMessage?.isOwn && c.lastMessage.status && (
                        <>
                          <Ticks status={c.lastMessage.status} />{' '}
                        </>
                      )}
                      {preview(c)}
                    </span>
                    {c.unreadCount > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white"
                        aria-label={t('groupChat.unread', { count: c.unreadCount }) ?? ''}
                      >
                        {c.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
