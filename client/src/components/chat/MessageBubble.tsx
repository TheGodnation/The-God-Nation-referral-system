import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import { formatBytes } from '../../lib/attachmentLimits';
import { getAttachmentUrl, useAttachmentUrl, useInView } from '../../lib/chatMedia';
import { mediaKind, type ChatAttachment, type ChatMessage, type ChatReplyPreview } from './types';

const NAME_COLORS = ['text-rose-700', 'text-emerald-700', 'text-violet-700', 'text-amber-700', 'text-sky-700', 'text-fuchsia-700', 'text-teal-700', 'text-orange-700'];

export function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "📷 Photo", "🎤 Voice message", … for a reply preview with no text. */
export function useMediaLabel() {
  const { t } = useTranslation();
  return (mime: string | null | undefined) => {
    const kind = mediaKind(mime);
    if (kind === 'photo') return `📷 ${t('groupChat.photo')}`;
    if (kind === 'video') return `🎥 ${t('groupChat.video')}`;
    if (kind === 'voice') return `🎤 ${t('groupChat.voice')}`;
    if (kind === 'document') return `📄 ${t('groupChat.document_label')}`;
    return '';
  };
}

export function ReplyQuote({ reply, onClick, own }: { reply: ChatReplyPreview; onClick?: () => void; own?: boolean }) {
  const { t } = useTranslation();
  const label = useMediaLabel();
  const text = reply.deleted ? t('groupChat.removed') : reply.body || label(reply.attachmentMimeType);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 block w-full rounded-md border-l-4 border-emerald-600 px-2 py-1 text-left text-xs ${own ? 'bg-emerald-900/10' : 'bg-slate-900/5'}`}
    >
      <span className={`block font-semibold ${nameColor(reply.senderName)}`}>{reply.senderName}</span>
      <span className="line-clamp-2 text-slate-600">{text}</span>
    </button>
  );
}

function PhotoAttachment({ communityId, messageId, a, onOpen }: { communityId: string; messageId: string; a: ChatAttachment; onOpen: (url: string) => void }) {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  const { url, failed } = useAttachmentUrl(communityId, messageId, a.id, inView);
  return (
    <div ref={ref} className="overflow-hidden rounded-md bg-slate-200">
      {url ? (
        <button type="button" className="block" onClick={() => onOpen(url)} aria-label={t('groupChat.open_photo') ?? ''}>
          <img src={url} alt={t('groupChat.photo') ?? ''} className="max-h-80 w-full min-w-[12rem] object-cover" />
        </button>
      ) : (
        <div className="flex h-48 w-56 items-center justify-center text-2xl text-slate-400">{failed ? '⚠️' : '📷'}</div>
      )}
    </div>
  );
}

function PlayableAttachment({ communityId, messageId, a }: { communityId: string; messageId: string; a: ChatAttachment }) {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  const { url, failed } = useAttachmentUrl(communityId, messageId, a.id, inView);
  const kind = mediaKind(a.mimeType);
  return (
    <div ref={ref}>
      {kind === 'voice' ? (
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">🎤</span>
          {url ? (
            <audio controls preload="metadata" src={url} className="h-10 w-56 max-w-full" aria-label={t('groupChat.voice') ?? ''} />
          ) : (
            <span className="text-xs text-slate-500">{failed ? '⚠️' : t('groupChat.loading')}</span>
          )}
        </div>
      ) : url ? (
        <video controls playsInline preload="metadata" src={url} className="max-h-80 w-full min-w-[12rem] rounded-md bg-black" aria-label={t('groupChat.video') ?? ''} />
      ) : (
        <div className="flex h-40 w-56 items-center justify-center rounded-md bg-slate-800 text-2xl text-white/70">{failed ? '⚠️' : '🎥'}</div>
      )}
    </div>
  );
}

function DocumentAttachment({ communityId, messageId, a }: { communityId: string; messageId: string; a: ChatAttachment }) {
  async function open() {
    try {
      const url = await getAttachmentUrl(communityId, messageId, a.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      /* the bubble stays as it is */
    }
  }
  return (
    <button type="button" onClick={open} className="flex w-full items-center gap-2 rounded-md bg-slate-900/5 px-2 py-2 text-left text-sm">
      <span aria-hidden className="text-2xl">📄</span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-800">{a.originalFilename}</span>
        <span className="text-xs text-slate-500">{formatBytes(a.byteSize)}</span>
      </span>
    </button>
  );
}

interface BubbleProps {
  m: ChatMessage;
  communityId: string;
  showSender: boolean;
  highlighted: boolean;
  onReply: (m: ChatMessage) => void;
  onMenu: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onJumpTo: (messageId: string) => void;
  onOpenPhoto: (url: string) => void;
}

const SWIPE_TRIGGER = 60;
const LONG_PRESS_MS = 450;

// One chat bubble. Swipe it right to reply, press and hold (or right-click)
// for reactions and options — the same gestures as WhatsApp.
export function MessageBubble({ m, communityId, showSender, highlighted, onReply, onMenu, onReact, onJumpTo, onOpenPhoto }: BubbleProps) {
  const { t } = useTranslation();
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number; swiping: boolean; timer: number | null; longPressed: boolean } | null>(null);

  const canInteract = !m.deleted && !m.pending;

  function onTouchStart(e: React.TouchEvent) {
    if (!canInteract) return;
    const p = e.touches[0];
    const state = { x: p.clientX, y: p.clientY, swiping: false, timer: null as number | null, longPressed: false };
    state.timer = window.setTimeout(() => {
      state.longPressed = true;
      if (navigator.vibrate) navigator.vibrate(15);
      onMenu(m);
    }, LONG_PRESS_MS);
    touch.current = state;
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = touch.current;
    if (!s) return;
    const p = e.touches[0];
    const mx = p.clientX - s.x;
    const my = p.clientY - s.y;
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
      if (s.timer) window.clearTimeout(s.timer);
      s.timer = null;
    }
    if (!s.swiping && mx > 12 && Math.abs(mx) > Math.abs(my) * 1.5) s.swiping = true;
    if (s.swiping) setDx(Math.max(0, Math.min(mx, 90)));
  }

  function onTouchEnd() {
    const s = touch.current;
    if (s?.timer) window.clearTimeout(s.timer);
    if (s?.swiping && dx >= SWIPE_TRIGGER) {
      if (navigator.vibrate) navigator.vibrate(10);
      onReply(m);
    }
    touch.current = null;
    setDx(0);
  }

  const photos = m.attachments.filter((a) => mediaKind(a.mimeType) === 'photo');
  const playables = m.attachments.filter((a) => ['video', 'voice'].includes(mediaKind(a.mimeType) ?? ''));
  const documents = m.attachments.filter((a) => mediaKind(a.mimeType) === 'document');
  const reactions = m.reactions ?? [];

  return (
    <div id={`msg-${m.id}`} className={`group relative flex items-end gap-1.5 ${m.isOwn ? 'justify-end' : 'justify-start'}`}>
      {!m.isOwn && (
        <span className="w-8 shrink-0">{showSender && <Avatar name={m.senderName} photoUrl={m.senderPhotoUrl} size={32} />}</span>
      )}

      <span
        aria-hidden
        className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-lg text-slate-500 transition-opacity"
        style={{ opacity: Math.min(1, dx / SWIPE_TRIGGER) }}
      >
        ↩️
      </span>

      <div
        className="max-w-[80%] transition-transform duration-75"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onContextMenu={(e) => {
          if (!canInteract) return;
          e.preventDefault();
          onMenu(m);
        }}
      >
        <div
          className={`relative rounded-lg px-2 pb-1 pt-1.5 text-[15px] shadow-sm ${
            m.isOwn ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'
          } ${highlighted ? 'ring-2 ring-amber-400' : ''} ${m.pending ? 'opacity-70' : ''}`}
        >
          {showSender && !m.isOwn && <p className={`mb-0.5 text-xs font-semibold ${nameColor(m.senderName)}`}>{m.senderName}</p>}

          {m.deleted ? (
            <p className="italic text-slate-500">🚫 {t('groupChat.removed')}</p>
          ) : (
            <>
              {m.replyTo && <ReplyQuote reply={m.replyTo} own={m.isOwn} onClick={() => onJumpTo(m.replyTo!.id)} />}
              {photos.length > 0 && (
                <div className={`mb-1 grid gap-1 ${photos.length > 1 ? 'grid-cols-2' : ''}`}>
                  {photos.map((a) => (
                    <PhotoAttachment key={a.id} communityId={communityId} messageId={m.id} a={a} onOpen={onOpenPhoto} />
                  ))}
                </div>
              )}
              {playables.map((a) => (
                <div key={a.id} className="mb-1">
                  <PlayableAttachment communityId={communityId} messageId={m.id} a={a} />
                </div>
              ))}
              {documents.map((a) => (
                <div key={a.id} className="mb-1">
                  <DocumentAttachment communityId={communityId} messageId={m.id} a={a} />
                </div>
              ))}
              {m.body && <p className="whitespace-pre-wrap break-words text-slate-900">{m.body}</p>}
            </>
          )}

          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-500">
            {m.pending ? `🕓 ${t('groupChat.sending')}` : timeOf(m.createdAt)}
          </p>

          {canInteract && (
            <button
              type="button"
              aria-label={t('groupChat.options') ?? ''}
              onClick={() => onMenu(m)}
              className="absolute right-1 top-1 hidden rounded bg-white/80 px-1 text-xs text-slate-500 focus:block group-hover:block"
            >
              ⌄
            </button>
          )}
        </div>

        {reactions.length > 0 && (
          <div className={`-mt-1 flex flex-wrap gap-1 ${m.isOwn ? 'justify-end' : 'justify-start'} px-1`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(m, r.emoji)}
                aria-pressed={r.mine}
                aria-label={t('groupChat.reaction_label', { emoji: r.emoji, count: r.count }) ?? ''}
                className={`rounded-full border px-1.5 text-xs shadow-sm ${r.mine ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}
              >
                {r.emoji}
                <span className="ml-0.5 text-slate-600">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
