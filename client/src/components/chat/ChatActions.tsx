import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';
import type { ChatMessage } from './types';

// WhatsApp actions shared by the group and private chat screens:
// edit a message, forward it, and search inside the chat.

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** ✏️ Edit message — change your own text (within 15 minutes). */
export function EditSheet({ message, onCancel, onSave }: { message: ChatMessage; onCancel: () => void; onSave: (body: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [body, setBody] = useState(message.body ?? '');
  const [saving, setSaving] = useState(false);
  const trimmed = body.trim();
  return (
    <Sheet label={t('chatActions.edit_title')} onClose={onCancel}>
      <h2 className="mb-2 font-semibold text-slate-900">✏️ {t('chatActions.edit_title')}</h2>
      <label className="sr-only" htmlFor="edit-message">
        {t('chatActions.edit_title')}
      </label>
      <textarea
        id="edit-message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={4}
        autoFocus
        className="w-full rounded-lg border border-slate-300 p-2 text-[15px]"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-slate-600">
          {t('chatActions.cancel')}
        </button>
        <button
          type="button"
          disabled={saving || !trimmed || trimmed === (message.body ?? '').trim()}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(trimmed);
            } finally {
              setSaving(false);
            }
          }}
          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('chatActions.save')}
        </button>
      </div>
    </Sheet>
  );
}

export interface ChatTarget {
  kind: 'group' | 'private';
  chatId: string;
  name: string;
  photoUrl: string | null;
}

interface PrivateRow {
  id: string;
  otherPartyType: 'CENTRAL_AUTHORITY' | 'LEADER' | 'MEMBER';
  otherPartyName?: string | null;
  otherPartyPhotoUrl?: string | null;
}

const MAX_TARGETS = 5;

/** ↪️ Forward — choose up to 5 chats (groups and private chats). */
export function ForwardSheet({
  source,
  onClose,
  onDone,
}: {
  source: { kind: 'group' | 'private'; chatId: string; messageId: string };
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const { t } = useTranslation();
  const [chats, setChats] = useState<ChatTarget[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api
        .get<{ items: { communityId: string; communityName: string; status?: string }[] }>('/api/member/me/community-memberships')
        .catch(() => ({ items: [] as { communityId: string; communityName: string; status?: string }[] })),
      api.get<{ items: PrivateRow[] }>('/api/private-messages/conversations?pageSize=100').catch(() => ({ items: [] as PrivateRow[] })),
    ]).then(([groups, privates]) => {
      if (!alive) return;
      setChats([
        ...groups.items
          .filter((g) => !g.status || g.status === 'ACTIVE')
          .map((g) => ({ kind: 'group' as const, chatId: g.communityId, name: g.communityName, photoUrl: null })),
        ...privates.items.map((p) => ({
          kind: 'private' as const,
          chatId: p.id,
          name: p.otherPartyType === 'CENTRAL_AUTHORITY' ? t('privateChat.headquarters') : p.otherPartyName || t('privateChat.someone'),
          photoUrl: p.otherPartyPhotoUrl ?? null,
        })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [t]);

  const key = (c: { kind: string; chatId: string }) => `${c.kind}:${c.chatId}`;
  const shown = (chats ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function toggle(c: ChatTarget) {
    const k = key(c);
    setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= MAX_TARGETS ? cur : [...cur, k]));
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const targets = picked.map((k) => {
        const [kind, ...rest] = k.split(':');
        return { kind, chatId: rest.join(':') };
      });
      await api.post('/api/chat/forward', { source, targets });
      onDone(targets.length);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 503 ? t('groupChat.storage_off') : t('chatActions.forward_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet label={t('chatActions.forward_title')} onClose={onClose}>
      <h2 className="mb-1 font-semibold text-slate-900">↪️ {t('chatActions.forward_title')}</h2>
      <p className="mb-2 text-xs text-slate-500">{t('chatActions.forward_hint', { max: MAX_TARGETS })}</p>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('chatActions.search_chats') ?? ''}
        aria-label={t('chatActions.search_chats') ?? ''}
        className="mb-2 w-full rounded-full border border-slate-300 px-3 py-1.5 text-sm"
      />
      {!chats ? (
        <p className="py-4 text-center text-sm text-slate-500">{t('groupChat.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{t('chatActions.no_chats')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((c) => {
            const on = picked.includes(key(c));
            return (
              <li key={key(c)}>
                <label className="flex cursor-pointer items-center gap-3 py-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(c)} disabled={!on && picked.length >= MAX_TARGETS} className="h-5 w-5 accent-emerald-600" />
                  <Avatar name={c.name} photoUrl={c.photoUrl} size={36} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{c.name}</span>
                  <span className="text-xs text-slate-400">{c.kind === 'group' ? `👥 ${t('chatActions.group')}` : ''}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="sticky bottom-0 mt-3 flex justify-end gap-2 bg-white pt-2">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-600">
          {t('chatActions.cancel')}
        </button>
        <button
          type="button"
          disabled={sending || picked.length === 0}
          onClick={() => void send()}
          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('chatActions.send_to', { count: picked.length })}
        </button>
      </div>
    </Sheet>
  );
}

interface SearchHit {
  id: string;
  senderName?: string;
  isOwn: boolean;
  body: string | null;
  createdAt: string;
}

/** 🔍 Search inside this chat. Tap a result to jump to it. */
export function ChatSearch({ searchPath, onPick, onClose }: { searchPath: string; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    // Waits until typing stops, so a slow network isn't asked every letter.
    timer.current = window.setTimeout(() => {
      api
        .get<{ items: SearchHit[] }>(`${searchPath}?q=${encodeURIComponent(term)}`)
        .then((r) => {
          setHits(r.items);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [q, searchPath]);

  function highlight(text: string) {
    const term = q.trim();
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0 || !term) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="rounded bg-amber-200">{text.slice(i, i + term.length)}</mark>
        {text.slice(i + term.length)}
      </>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 z-30 flex max-h-[70vh] flex-col bg-white shadow-lg">
      <div className="flex items-center gap-2 bg-brand-800 px-2 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={onClose} aria-label={t('chatActions.close_search') ?? ''} className="px-2 text-2xl leading-none text-white">
          ←
        </button>
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('chatActions.search_placeholder') ?? ''}
          aria-label={t('chatActions.search_placeholder') ?? ''}
          className="flex-1 rounded-full px-3 py-1.5 text-sm text-slate-900"
        />
      </div>
      <div className="overflow-y-auto">
        {failed && <p className="p-3 text-sm text-red-700">{t('groupChat.load_failed')}</p>}
        {hits && hits.length === 0 && <p className="p-3 text-sm text-slate-500">{t('chatActions.no_results')}</p>}
        {hits && hits.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onPick(h.id)} className="block w-full px-3 py-2 text-left">
                  <span className="flex justify-between text-xs text-slate-500">
                    <span className="font-semibold">{h.isOwn ? t('groupChat.you') : h.senderName ?? ''}</span>
                    <span>{new Date(h.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
                  </span>
                  <span className="line-clamp-2 text-sm text-slate-800">{highlight(h.body ?? '')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Jump to a message, loading older pages first if it isn't on screen yet
 * (up to 10 pages). `loadOlderPage` resolves to false when nothing older
 * is left.
 */
export async function findAndJump(id: string, loadOlderPage: () => Promise<boolean>, jump: (id: string) => void, notFound: () => void) {
  const wait = () => new Promise((r) => window.setTimeout(r, 60));
  for (let i = 0; i <= 10; i++) {
    if (document.getElementById(`msg-${id}`)) {
      jump(id);
      return;
    }
    if (i === 10 || !(await loadOlderPage())) break;
    await wait();
  }
  if (document.getElementById(`msg-${id}`)) jump(id);
  else notFound();
}
