import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../lib/attachmentLimits';
import {
  ChatUploadError,
  baseMime,
  extensionFor,
  formatDuration,
  pickRecorderMime,
  shrinkPhoto,
  uploadChatFile,
  type UploadedAttachment,
  type UploadProblem,
} from '../../lib/chatMedia';
import { VideoRecorder } from './VideoRecorder';
import { ReplyQuote } from './MessageBubble';
import type { ChatMessage } from './types';

export interface OutgoingMessage {
  body?: string;
  attachments?: UploadedAttachment[];
  replyToMessageId?: string;
}

interface TrayItem {
  localId: string;
  name: string;
  kind: 'photo' | 'video' | 'document';
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'error';
  uploaded?: UploadedAttachment;
}

const MAX_VOICE_MS = 5 * 60 * 1000;
const MIN_VOICE_MS = 700;
const HOLD_TO_SEND_MS = 450;
const SLIDE_TO_CANCEL_PX = 90;

function objectUrl(b: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null;
}

function revoke(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The WhatsApp-style bar at the bottom of a chat: type a message, attach
// photos/videos/documents, record a video, or hold the microphone to record
// a voice note (slide left to cancel; a quick tap records hands-free).
export function ChatComposer({
  uploadPath,
  replyTo,
  onCancelReply,
  onSend,
}: {
  /** Where to ask for an upload link (group or private chat). */
  uploadPath: string;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (msg: OutgoingMessage) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  // Voice note recording
  const [recording, setRecording] = useState<{ locked: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pressRef = useRef<{ x: number; at: number; up: boolean } | null>(null);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms);
      if (ms >= MAX_VOICE_MS) finishVoice(true);
    }, 200);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  function problemText(reason: UploadProblem) {
    if (reason === 'storage') return t('groupChat.storage_off');
    if (reason === 'size') return t('groupChat.too_big');
    if (reason === 'type') return t('groupChat.wrong_type');
    return t('groupChat.upload_failed');
  }

  function resizeText(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // ---------- Attachments ----------
  async function addFiles(list: FileList | null) {
    setMenuOpen(false);
    setError(null);
    if (!list || list.length === 0) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - tray.length;
    const files = Array.from(list).slice(0, Math.max(0, room));
    if (files.length < list.length) setError(t('groupChat.max_files', { count: MAX_ATTACHMENTS_PER_MESSAGE }));
    for (const file of files) {
      const type = baseMime(file.type);
      const kind: TrayItem['kind'] = type.startsWith('image/') ? 'photo' : type.startsWith('video/') ? 'video' : 'document';
      const item: TrayItem = {
        localId: newId(),
        name: file.name,
        kind,
        previewUrl: kind === 'document' ? null : objectUrl(file),
        status: 'uploading',
      };
      setTray((prev) => [...prev, item]);
      void (async () => {
        try {
          let blob: Blob = file;
          let name = file.name || `file.${extensionFor(type)}`;
          if (kind === 'photo') {
            blob = await shrinkPhoto(file);
            if (blob !== file) name = name.replace(/\.[^.]+$/, '') + '.jpg';
          }
          const uploaded = await uploadChatFile(uploadPath, blob, name);
          setTray((prev) => prev.map((x) => (x.localId === item.localId ? { ...x, status: 'ready', uploaded } : x)));
        } catch (err) {
          setTray((prev) => prev.map((x) => (x.localId === item.localId ? { ...x, status: 'error' } : x)));
          setError(problemText(err instanceof ChatUploadError ? err.reason : 'failed'));
        }
      })();
    }
  }

  function removeFromTray(localId: string) {
    setTray((prev) => {
      const gone = prev.find((x) => x.localId === localId);
      if (gone) revoke(gone.previewUrl);
      return prev.filter((x) => x.localId !== localId);
    });
  }

  function onVideoRecorded(blob: Blob) {
    setVideoOpen(false);
    const mime = baseMime(blob.type);
    const file = new File([blob], `video-${Date.now()}.${extensionFor(mime)}`, { type: mime });
    const dt = typeof DataTransfer !== 'undefined' ? new DataTransfer() : null;
    if (dt) {
      dt.items.add(file);
      void addFiles(dt.files);
    } else {
      void addFiles({ 0: file, length: 1, item: () => file } as unknown as FileList);
    }
  }

  // ---------- Sending ----------
  const uploading = tray.some((x) => x.status === 'uploading');
  const ready = tray.filter((x) => x.status === 'ready' && x.uploaded).map((x) => x.uploaded!);
  const hasContent = text.trim().length > 0 || ready.length > 0;

  async function send() {
    if (!hasContent || uploading || busy) return;
    setBusy(true);
    setError(null);
    const ok = await onSend({
      body: text.trim() || undefined,
      attachments: ready.length ? ready : undefined,
      replyToMessageId: replyTo?.id,
    });
    setBusy(false);
    if (ok) {
      setText('');
      tray.forEach((x) => revoke(x.previewUrl));
      setTray([]);
      if (textRef.current) textRef.current.style.height = 'auto';
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      void send();
    }
  }

  // ---------- Voice notes ----------
  async function startVoice(): Promise<boolean> {
    setError(null);
    const mime = pickRecorderMime('audio');
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      setError(t('groupChat.no_recording'));
      return false;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('groupChat.mic_denied'));
      return false;
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.start(500);
    recorderRef.current = rec;
    streamRef.current = stream;
    startedAtRef.current = Date.now();
    lockedRef.current = false;
    setElapsed(0);
    setRecording({ locked: false });
    return true;
  }

  function lockVoice() {
    lockedRef.current = true;
    setRecording((r) => (r ? { locked: true } : r));
  }

  function finishVoice(send: boolean) {
    const rec = recorderRef.current;
    recorderRef.current = null;
    pressRef.current = null;
    setRecording(null);
    if (!rec) return;
    const duration = Date.now() - startedAtRef.current;
    const mime = baseMime(rec.mimeType || 'audio/webm');
    rec.onstop = () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (!send) return;
      if (duration < MIN_VOICE_MS) {
        setError(t('groupChat.hold_longer'));
        return;
      }
      const blob = new Blob(chunksRef.current, { type: mime });
      void sendVoice(blob, mime);
    };
    if (rec.state !== 'inactive') rec.stop();
    else rec.onstop?.(new Event('stop'));
  }

  async function sendVoice(blob: Blob, mime: string) {
    setBusy(true);
    try {
      const uploaded = await uploadChatFile(uploadPath, blob, `voice-note-${Date.now()}.${extensionFor(mime)}`);
      await onSend({ attachments: [uploaded], replyToMessageId: replyTo?.id });
    } catch (err) {
      setError(problemText(err instanceof ChatUploadError ? err.reason : 'failed'));
    } finally {
      setBusy(false);
    }
  }

  function micDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (recording || busy) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    const press = { x: e.clientX, at: Date.now(), up: false };
    pressRef.current = press;
    void startVoice().then((ok) => {
      // Finger already lifted (e.g. while allowing the microphone): keep
      // recording hands-free with Cancel / Send buttons.
      if (ok && press.up) lockVoice();
    });
  }

  function micMove(e: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || press.up || !recorderRef.current || lockedRef.current) return;
    if (press.x - e.clientX > SLIDE_TO_CANCEL_PX) finishVoice(false);
  }

  function micUp() {
    const press = pressRef.current;
    if (!press) return;
    press.up = true;
    if (!recorderRef.current || lockedRef.current) return;
    if (Date.now() - press.at < HOLD_TO_SEND_MS) lockVoice();
    else finishVoice(true);
  }

  function micClick(e: React.MouseEvent) {
    // Keyboard users (Enter/Space) start hands-free recording.
    if (e.detail === 0 && !recording) {
      void startVoice().then((ok) => ok && lockVoice());
    }
  }

  return (
    <div className="border-t border-slate-200 bg-[#f0f2f5] px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
      {error && (
        <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-white p-2">
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-xs text-slate-500">{t('groupChat.replying_to', { name: replyTo.isOwn ? t('groupChat.you') : replyTo.senderName })}</p>
            <ReplyQuote
              reply={{
                id: replyTo.id,
                senderName: replyTo.isOwn ? t('groupChat.you') : replyTo.senderName,
                body: replyTo.body,
                deleted: replyTo.deleted,
                attachmentMimeType: replyTo.attachments[0]?.mimeType ?? null,
              }}
            />
          </div>
          <button type="button" onClick={onCancelReply} aria-label={t('groupChat.cancel_reply') ?? ''} className="px-1 text-slate-500">
            ✕
          </button>
        </div>
      )}

      {tray.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {tray.map((x) => (
            <div key={x.localId} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-300">
              {x.kind === 'photo' && x.previewUrl ? (
                <img src={x.previewUrl} alt={x.name} className="h-full w-full object-cover" />
              ) : x.kind === 'video' && x.previewUrl ? (
                <video src={x.previewUrl} muted playsInline className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center p-1 text-center text-[10px] text-slate-700">
                  <span className="text-2xl">📄</span>
                  <span className="line-clamp-2">{x.name}</span>
                </div>
              )}
              {x.status !== 'ready' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white">
                  {x.status === 'uploading' ? t('groupChat.uploading') : '⚠️'}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFromTray(x.localId)}
                aria-label={t('groupChat.remove_attachment', { name: x.name }) ?? ''}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 text-xs text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {menuOpen && (
        <div className="mb-2 grid grid-cols-4 gap-2 rounded-xl bg-white p-3 text-center text-xs text-slate-700 shadow">
          <button type="button" onClick={() => galleryRef.current?.click()} className="flex flex-col items-center gap-1">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-2xl">🖼️</span>
            {t('groupChat.gallery')}
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex flex-col items-center gap-1">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-2xl">📷</span>
            {t('groupChat.camera')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setVideoOpen(true);
            }}
            className="flex flex-col items-center gap-1"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-2xl">🎥</span>
            {t('groupChat.record_video')}
          </button>
          <button type="button" onClick={() => docRef.current?.click()} className="flex flex-col items-center gap-1">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-2xl">📄</span>
            {t('groupChat.document')}
          </button>
        </div>
      )}

      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" data-testid="chat-gallery-input" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={docRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />

      <div className="flex items-end gap-2">
        {recording ? (
          <div className="flex min-h-[44px] flex-1 items-center gap-3 rounded-3xl bg-white px-4 py-2">
            {recording.locked && (
              <button type="button" onClick={() => finishVoice(false)} aria-label={t('groupChat.cancel') ?? ''} className="text-xl">
                🗑️
              </button>
            )}
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" aria-hidden />
            <span className="font-mono text-sm text-slate-700" aria-live="polite">
              {formatDuration(elapsed)}
            </span>
            <span className="flex-1 truncate text-right text-sm text-slate-500">
              {recording.locked ? t('groupChat.recording') : t('groupChat.slide_cancel')}
            </span>
          </div>
        ) : (
          <div className="flex min-h-[44px] flex-1 items-end rounded-3xl bg-white px-2">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('groupChat.attach') ?? ''}
              aria-expanded={menuOpen}
              className="p-2 text-xl text-slate-500"
            >
              📎
            </button>
            <textarea
              ref={textRef}
              rows={1}
              maxLength={2000}
              value={text}
              aria-label={t('groupChat.type_message') ?? ''}
              placeholder={t('groupChat.type_message') ?? ''}
              onChange={(e) => {
                setText(e.target.value);
                resizeText(e.target);
              }}
              onKeyDown={onKeyDown}
              className="max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-[16px] leading-6 outline-none focus:ring-0"
            />
            {!text.trim() && (
              <button type="button" onClick={() => cameraRef.current?.click()} aria-label={t('groupChat.camera') ?? ''} className="p-2 text-xl text-slate-500">
                📷
              </button>
            )}
          </div>
        )}

        {recording?.locked ? (
          <button
            type="button"
            onClick={() => finishVoice(true)}
            aria-label={t('groupChat.send_voice') ?? ''}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg text-white"
          >
            ➤
          </button>
        ) : hasContent || uploading ? (
          <button
            type="button"
            onClick={() => void send()}
            disabled={uploading || busy}
            aria-label={t('groupChat.send') ?? ''}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg text-white disabled:bg-emerald-300"
          >
            ➤
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={micDown}
            onPointerMove={micMove}
            onPointerUp={micUp}
            onPointerCancel={micUp}
            onClick={micClick}
            onContextMenu={(e) => e.preventDefault()}
            disabled={busy}
            style={{ touchAction: 'none' }}
            aria-label={t('groupChat.record_voice') ?? ''}
            title={t('groupChat.record_voice') ?? ''}
            className={`flex shrink-0 select-none items-center justify-center rounded-full text-lg text-white transition-all ${
              recording ? 'h-16 w-16 bg-red-500' : 'h-11 w-11 bg-emerald-600'
            } disabled:bg-emerald-300`}
          >
            🎤
          </button>
        )}
      </div>

      {videoOpen && <VideoRecorder onDone={onVideoRecorded} onClose={() => setVideoOpen(false)} />}
    </div>
  );
}
