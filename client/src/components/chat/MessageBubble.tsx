import { CoordinatorBadge } from '../CoordinatorBadge';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Avatar } from '../Avatar';
import { TranslationNote } from '../TranslationNote';
import { formatBytes } from '../../lib/attachmentLimits';
import { getAttachmentUrl, useAttachmentUrl, useInView } from '../../lib/chatMedia';
import { isPdf } from '../../lib/pdfPreview';
import { DocumentCard } from './DocumentCard';
import { PdfViewer } from './PdfViewer';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { docKey, getFile } from '../../lib/offlineStore';
import { useDataSaver } from '../../lib/dataSaver';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { TeachingCard } from '../teaching/TeachingCard';
import { mediaKind, type ChatAttachment, type ChatMessage, type ChatReplyPreview } from './types';
import { RichText, plainPreview } from '../../lib/richText';

const NAME_COLORS = ['text-rose-700', 'text-emerald-700', 'text-violet-700', 'text-amber-700', 'text-sky-700', 'text-fuchsia-700', 'text-teal-700', 'text-orange-700'];

// Same thresholds as UpdatesFeed.tsx's own long-post truncation — a message
// this long would otherwise fill the whole chat screen on its own.
const LONG_MESSAGE_CHARS = 300;
const LONG_MESSAGE_LINES = 7;

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
  const text = reply.deleted ? t('groupChat.removed') : plainPreview(reply.body) || label(reply.attachmentMimeType);
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

function PhotoAttachment({ mediaBase, messageId, a, onOpen }: { mediaBase: string; messageId: string; a: ChatAttachment; onOpen: (url: string) => void }) {
  const { t } = useTranslation();
  const saver = useDataSaver();
  const [wanted, setWanted] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>();
  // With "Save data" on, the real photo only downloads after a tap.
  const { url, failed } = useAttachmentUrl(mediaBase, messageId, a.id, inView && (!saver || wanted));
  const [loaded, setLoaded] = useState(false);
  return (
    <div ref={ref} className="relative min-h-[8rem] min-w-[12rem] overflow-hidden rounded-md bg-slate-200">
      {a.thumb && !loaded && (
        <img src={a.thumb} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />
      )}
      {url && (
        <button type="button" className="relative block w-full" onClick={() => onOpen(url)} aria-label={t('groupChat.open_photo') ?? ''}>
          <img
            src={url}
            alt={t('groupChat.photo') ?? ''}
            onLoad={() => setLoaded(true)}
            className={`max-h-80 w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </button>
      )}
      {!url && (
        <div className="relative flex h-48 w-full items-center justify-center">
          {failed ? (
            <span className="text-2xl">⚠️</span>
          ) : saver && !wanted ? (
            <button
              type="button"
              onClick={() => setWanted(true)}
              className="rounded-full bg-black/55 px-3 py-2 text-sm font-semibold text-white"
              aria-label={t('network.download_photo', { size: formatBytes(a.byteSize) }) ?? ''}
            >
              ⬇ {formatBytes(a.byteSize)}
            </button>
          ) : (
            !a.thumb && <span className="text-2xl text-slate-400">📷</span>
          )}
        </div>
      )}
    </div>
  );
}

function PlayableAttachment({
  mediaBase,
  messageId,
  a,
  senderName,
  senderPhotoUrl,
  isOwn,
}: {
  mediaBase: string;
  messageId: string;
  a: ChatAttachment;
  senderName: string;
  senderPhotoUrl?: string | null;
  isOwn: boolean;
}) {
  const { t } = useTranslation();
  const saver = useDataSaver();
  const [wanted, setWanted] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>();
  const { url, failed } = useAttachmentUrl(mediaBase, messageId, a.id, inView && (!saver || wanted));
  const kind = mediaKind(a.mimeType);
  const waitForTap = saver && !wanted && !url;
  return (
    <div ref={ref}>
      {kind === 'voice' ? (
        <VoiceNotePlayer
          url={url}
          byteSize={a.byteSize}
          seedId={a.id}
          avatarName={senderName}
          avatarPhotoUrl={senderPhotoUrl}
          own={isOwn}
          waitForTap={waitForTap}
          failed={failed}
          onRequestDownload={() => setWanted(true)}
        />
      ) : url ? (
        // preload="none": nothing downloads until the person presses play.
        <video controls playsInline preload="none" src={url} className="max-h-80 w-full min-w-[12rem] rounded-md bg-black" aria-label={t('groupChat.video') ?? ''} />
      ) : waitForTap ? (
        <button
          type="button"
          onClick={() => setWanted(true)}
          className="flex h-40 w-56 flex-col items-center justify-center gap-1 rounded-md bg-slate-800 text-sm font-semibold text-white"
          aria-label={t('network.download_video', { size: formatBytes(a.byteSize) }) ?? ''}
        >
          <span className="text-3xl">▶</span>⬇ {formatBytes(a.byteSize)}
        </button>
      ) : (
        <div className="flex h-40 w-56 items-center justify-center rounded-md bg-slate-800 text-2xl text-white/70">{failed ? '⚠️' : '🎥'}</div>
      )}
    </div>
  );
}

function DocumentAttachment({ mediaBase, messageId, a }: { mediaBase: string; messageId: string; a: ChatAttachment }) {
  const { member } = useMemberAuth();
  const ownerId = member?.personId;
  const [view, setView] = useState<{ url?: string; data?: Blob } | null>(null);
  async function open() {
    const pdf = isPdf(a.mimeType);
    // Kept on this phone from an earlier view: opens at once, even offline.
    const saved = pdf && ownerId ? await getFile(docKey(ownerId, a.id)) : null;
    if (saved) return setView({ data: saved.blob });
    try {
      const url = await getAttachmentUrl(mediaBase, messageId, a.id);
      // PDFs open inside the app (see PdfViewer); anything else the usual way.
      if (pdf) setView({ url });
      else window.open(url, '_blank', 'noopener');
    } catch {
      /* the bubble stays as it is */
    }
  }
  return (
    <>
      <button type="button" onClick={open} className="block w-full text-left">
        <DocumentCard name={a.originalFilename} byteSize={a.byteSize} pageCount={a.pageCount} thumb={a.thumb} />
      </button>
      {view && (
        <PdfViewer
          url={view.url}
          data={view.data}
          name={a.originalFilename}
          keep={ownerId ? { key: docKey(ownerId, a.id), ownerId, meta: { mediaBase, messageId, attachmentId: a.id, byteSize: a.byteSize } } : undefined}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
}

/** WhatsApp ticks: ✓ sent, ✓✓ grey received, ✓✓ blue seen. */
export function Ticks({ status }: { status: 'sent' | 'delivered' | 'read' }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`groupChat.tick_${status}`) ?? ''}
      title={t(`groupChat.tick_${status}`) ?? ''}
      className={`ml-0.5 font-bold tracking-[-0.25em] ${status === 'read' ? 'text-sky-500' : 'text-slate-400'}`}
    >
      {status === 'sent' ? '✓' : '✓✓'}
    </span>
  );
}

interface BubbleProps {
  m: ChatMessage;
  mediaBase: string;
  showSender: boolean;
  highlighted: boolean;
  onReply: (m: ChatMessage) => void;
  onMenu: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onJumpTo: (messageId: string) => void;
  onOpenPhoto: (url: string) => void;
  /** Tapping the reactions under a message: who reacted (see ReactionsSheet). */
  onShowReactions?: (m: ChatMessage) => void;
  /** One-to-one chats (like WhatsApp) show no sender photos or names. */
  privateChat?: boolean;
}

const SWIPE_TRIGGER = 60;
const LONG_PRESS_MS = 450;

// One chat bubble. Swipe it right to reply, press and hold (or right-click)
// for reactions and options — the same gestures as WhatsApp.
export function MessageBubble({ m, mediaBase, showSender: showSenderProp, highlighted, onReply, onMenu, onReact, onJumpTo, onOpenPhoto, onShowReactions, privateChat = false }: BubbleProps) {
  const showSender = showSenderProp && !privateChat;
  const { t } = useTranslation();
  const [dx, setDx] = useState(0);
  // WhatsApp-style long-message truncation — same threshold/pattern as
  // UpdatesFeed's own "Read more" (length OR line count, whichever comes
  // first), so a long message never pushes the whole chat screen out of
  // view. Collapsed by default; one toggle per bubble.
  const [expanded, setExpanded] = useState(false);
  // Auto-translation — shows the translated text by default, with a
  // "Translated from X / Show original" toggle (Facebook-style); the
  // original is never hidden, just one tap away. Long-message truncation
  // applies to whichever text is actually showing, not always m.body.
  const [showOriginal, setShowOriginal] = useState(false);
  const [showOriginalTranscript, setShowOriginalTranscript] = useState(false);
  const displayBody = m.translation && !showOriginal ? m.translation.translatedBody : m.body;
  const isLongBody = Boolean(displayBody) && (displayBody!.length > LONG_MESSAGE_CHARS || displayBody!.split('\n').length > LONG_MESSAGE_LINES);
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

  // A teaching is shown as a card; its file is played on the teaching's own page.
  const shown = m.teaching ? [] : m.attachments;
  const photos = shown.filter((a) => mediaKind(a.mimeType) === 'photo');
  const playables = shown.filter((a) => ['video', 'voice'].includes(mediaKind(a.mimeType) ?? ''));
  const documents = shown.filter((a) => mediaKind(a.mimeType) === 'document');
  const reactions = m.reactions ?? [];

  return (
    <div id={`msg-${m.id}`} className={`group relative flex items-end gap-1.5 ${m.isOwn ? 'justify-end' : 'justify-start'}`}>
      {!m.isOwn && !privateChat && (
        <span className="w-8 shrink-0">
          {showSender &&
            (m.senderPersonId ? (
              <Link to={`/member/people/${m.senderPersonId}`} aria-label={m.senderName}>
                <Avatar name={m.senderName} photoUrl={m.senderPhotoUrl} size={32} />
              </Link>
            ) : (
              <Avatar name={m.senderName} photoUrl={m.senderPhotoUrl} size={32} />
            ))}
        </span>
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
            m.isOwn ? 'rounded-br-sm bg-[#d9fdd3]' : 'rounded-bl-sm bg-white'
          } ${highlighted ? 'ring-2 ring-amber-400' : ''} ${m.pending ? 'opacity-70' : ''}`}
        >
          {showSender && !m.isOwn && (
            <p className={`mb-0.5 text-xs font-semibold ${nameColor(m.senderName)}`}>
              {m.senderPersonId ? (
                <Link to={`/member/people/${m.senderPersonId}`} className="hover:underline">
                  {m.senderName}
                </Link>
              ) : (
                m.senderName
              )}
              <CoordinatorBadge badge={m.senderBadge} />
            </p>
          )}

          {m.deleted ? (
            <p className="italic text-slate-500">
              🚫 {m.deletedBySender ? (m.isOwn ? t('chatActions.you_deleted') : t('chatActions.deleted')) : t('groupChat.removed')}
            </p>
          ) : (
            <>
              {m.forwarded && <p className="mb-0.5 text-xs italic text-slate-500">↪ {t('chatActions.forwarded')}</p>}
              {m.teaching && <TeachingCard teaching={m.teaching} />}
              {m.replyTo && <ReplyQuote reply={m.replyTo} own={m.isOwn} onClick={() => onJumpTo(m.replyTo!.id)} />}
              {photos.length > 0 && (
                <div className={`mb-1 grid gap-1 ${photos.length > 1 ? 'grid-cols-2' : ''}`}>
                  {photos.map((a) => (
                    <PhotoAttachment key={a.id} mediaBase={mediaBase} messageId={m.id} a={a} onOpen={onOpenPhoto} />
                  ))}
                </div>
              )}
              {playables.map((a) => (
                <div key={a.id} className="mb-1">
                  <PlayableAttachment mediaBase={mediaBase} messageId={m.id} a={a} senderName={m.senderName} senderPhotoUrl={m.senderPhotoUrl} isOwn={m.isOwn} />
                </div>
              ))}
              {m.transcript && (
                <div className="mb-1 rounded-md bg-slate-900/5 px-2 py-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('translation.transcript_label')}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-800">
                    {showOriginalTranscript && m.transcript.original ? m.transcript.original : m.transcript.text}
                  </p>
                  {m.transcript.translated && (
                    <TranslationNote
                      sourceLanguage={m.transcript.sourceLanguage}
                      showingOriginal={showOriginalTranscript}
                      onToggle={() => setShowOriginalTranscript((v) => !v)}
                      showOriginalLabel={t('translation.show_original_transcript') ?? undefined}
                      showTranslationLabel={t('translation.show_translated_transcript') ?? undefined}
                    />
                  )}
                </div>
              )}
              {documents.map((a) => (
                <div key={a.id} className="mb-1">
                  <DocumentAttachment mediaBase={mediaBase} messageId={m.id} a={a} />
                </div>
              ))}
              {displayBody && !m.teaching && (
                <>
                  <RichText className={`whitespace-pre-wrap break-words text-slate-900 ${isLongBody && !expanded ? 'line-clamp-6' : ''}`} text={displayBody} />
                  {isLongBody && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((v) => !v);
                      }}
                      className="text-sm font-semibold text-emerald-700"
                    >
                      {expanded ? t('groupChat.read_less') : t('groupChat.read_more')}
                    </button>
                  )}
                  {m.translation && (
                    <TranslationNote sourceLanguage={m.translation.sourceLanguage} showingOriginal={showOriginal} onToggle={() => setShowOriginal((v) => !v)} />
                  )}
                </>
              )}
            </>
          )}

          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-500">
            {m.edited && !m.deleted && <span className="italic">{t('chatActions.edited')}</span>}
            {m.pending ? `🕓 ${m.queued ? t('network.waiting') : t('groupChat.sending')}` : timeOf(m.createdAt)}
            {m.isOwn && !m.pending && !m.deleted && m.status && <Ticks status={m.status} />}
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
                onClick={() => (onShowReactions ? onShowReactions(m) : onReact(m, r.emoji))}
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
