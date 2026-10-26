import { LengthNote } from '../LengthNote';
import { MAX_MESSAGE_CHARS, isTooLong } from '../../lib/textLimits';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../lib/attachmentLimits';
import {
  ChatUploadError,
  baseMime,
  extensionFor,
  formatDuration,
  pickRecorderMime,
  uploadChatFile,
  type UploadedAttachment,
  type UploadProblem,
} from '../../lib/chatMedia';
import { VideoRecorder } from './VideoRecorder';
import { MediaPreview } from './MediaPreview';
import { ReplyQuote } from './MessageBubble';
import { VoiceInputButton } from '../VoiceInputButton';
import { ChatIcon } from './icons';
import type { ChatMessage } from './types';
import { loadDraft, saveDraft } from '../../lib/drafts';
import { FormatBar } from '../FormatBar';
import { LiveFormatTextarea } from '../LiveFormatTextarea';

export interface OutgoingMessage {
  body?: string;
  attachments?: UploadedAttachment[];
  replyToMessageId?: string;
}

// The emoji list is only downloaded the first time someone opens the panel.
const EmojiPanel = lazy(() => import('./EmojiPanel'));

const MAX_VOICE_MS = 5 * 60 * 1000;
// How many bars the live waveform shows while recording (newest on the right).
const LIVE_BARS = 40;
const MIN_VOICE_MS = 700;
// WhatsApp's own per-message character limit — the server enforces the same.

// The WhatsApp-style bar at the bottom of a chat: the smiley opens an emoji
// panel in the keyboard's place, then the message box, the paperclip
// (photos/videos/documents/video recording) and the camera; the big round
// button records a voice note, or sends once something is typed. Recording
// needs no holding: it shows a live waveform with Delete, Pause/Resume and
// Send.
export function ChatComposer({
  uploadPath,
  replyTo,
  onCancelReply,
  onSend,
  onPickMedia,
  onTyping,
  onNewTeaching,
  draftKey,
}: {
  /** Where to ask for an upload link (group or private chat). */
  uploadPath: string;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (msg: OutgoingMessage) => Promise<boolean>;
  /** Photos/videos/documents sent from the preview screen, with their
   * caption: the chat shows them straight away as a message with a progress
   * circle and sends them (see useMediaUploads). */
  onPickMedia: (files: File[], caption?: string) => void;
  /** Only for the central admin in an assembly: opens the "new teaching" screen. */
  onNewTeaching?: () => void;
  /** Tells the others "typing…" (sent at most every few seconds). */
  onTyping?: (typing: boolean) => void;
  /** Where to keep what is typed but not sent yet (see lib/drafts). The
   * parent keys the composer by this, so each chat has its own box. */
  draftKey?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => loadDraft(draftKey));
  const latestText = useRef(text);
  latestText.current = text;

  // Keep the draft as it is typed, and again whenever the page is left or
  // hidden (switching apps), so nothing typed is lost.
  useEffect(() => {
    if (!draftKey) return;
    const timer = window.setTimeout(() => saveDraft(draftKey, text), 300);
    return () => window.clearTimeout(timer);
  }, [draftKey, text]);
  useEffect(() => {
    if (!draftKey) return;
    const flush = () => saveDraft(draftKey, latestText.current);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [draftKey]);
  const lastTypingSent = useRef(0);

  function signalTyping(value: string) {
    if (!onTyping) return;
    const now = Date.now();
    if (!value.trim()) {
      if (lastTypingSent.current) onTyping(false);
      lastTypingSent.current = 0;
      return;
    }
    if (now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      onTyping(true);
    }
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // The bold / italic / list buttons: opened with the "Aa" button, or by selecting words.
  const [formatOpen, setFormatOpen] = useState(false);
  // Where the caret was in the message box, so an emoji picked while the
  // keyboard is hidden still lands in the right place.
  const cursorRef = useRef<{ start: number; end: number } | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Picked files wait on the WhatsApp-style preview screen (caption, add
  // more, remove) until Send.
  const [preview, setPreview] = useState<File[] | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  // Voice note recording
  const [recording, setRecording] = useState<{ locked: boolean; paused: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lockedRef = useRef(false);
  // Recorded time leaves out paused stretches: time banked before the last
  // pause, plus the time since the last start/resume.
  const bankedMsRef = useRef(0);
  const resumedAtRef = useRef(0);
  const pausedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  const isRecording = recording !== null;
  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const ms = recordedMs();
      setElapsed(ms);
      if (ms >= MAX_VOICE_MS) finishVoice(true);
      else if (!pausedRef.current) setLevels((prev) => [...prev, micLevel()].slice(-LIVE_BARS));
    }, 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      void audioCtxRef.current?.close().catch(() => {});
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

  // Dictation (Web Speech API) — distinct from the 🎤 voice-NOTE recorder
  // below, which records and sends audio instead of typing it. The
  // textarea is controlled, so resizing happens in the effect below once
  // the new value actually reaches the DOM (unlike typing's onChange,
  // which can resize synchronously off the browser's own DOM update).
  function onVoiceInputResult(transcript: string) {
    const next = text.trim() ? `${text.trim()} ${transcript}` : transcript;
    setText(next);
    signalTyping(next);
  }

  useEffect(() => {
    if (textRef.current) resizeText(textRef.current);
  }, [text]);

  // ---------- Emoji panel ----------
  function rememberCursor(el: HTMLTextAreaElement) {
    cursorRef.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  }

  function caret() {
    const c = cursorRef.current;
    const start = Math.min(c?.start ?? text.length, text.length);
    return { start, end: Math.max(start, Math.min(c?.end ?? start, text.length)) };
  }

  function insertEmoji(emoji: string) {
    const { start, end } = caret();
    const next = text.slice(0, start) + emoji + text.slice(end);
    if (next.length > MAX_MESSAGE_CHARS) return;
    cursorRef.current = { start: start + emoji.length, end: start + emoji.length };
    setText(next);
    signalTyping(next);
  }

  // The panel's delete key: removes the selection, or else one whole emoji
  // or letter before the caret (an emoji can be several characters long).
  function deleteBeforeCaret() {
    const { start, end } = caret();
    let from = start;
    if (start === end) {
      const before = text.slice(0, start);
      const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
      const parts = Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(before), (x) => x.segment) : Array.from(before);
      from = start - (parts[parts.length - 1]?.length ?? 0);
    }
    const next = text.slice(0, from) + text.slice(end);
    cursorRef.current = { start: from, end: from };
    setText(next);
    signalTyping(next);
  }

  function toggleEmoji() {
    if (emojiOpen) {
      setEmojiOpen(false);
      textRef.current?.focus();
    } else {
      // Hides the phone keyboard so the panel can take its place.
      textRef.current?.blur();
      setMenuOpen(false);
      setEmojiOpen(true);
    }
  }

  // ---------- Attachments ----------
  function addFiles(list: FileList | null) {
    setMenuOpen(false);
    setError(null);
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const already = preview ?? [];
    const files = [...already, ...picked].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    if (files.length < already.length + picked.length) setError(t('groupChat.max_files', { count: MAX_ATTACHMENTS_PER_MESSAGE }));
    setEmojiOpen(false);
    textRef.current?.blur();
    setPreview(files);
  }

  function sendPreview(caption: string) {
    if (!preview?.length) return;
    onPickMedia(preview, caption || undefined);
    setPreview(null);
    // What was typed in the bar became the caption.
    if (text) {
      setText('');
      signalTyping('');
      cursorRef.current = null;
    }
  }

  function onVideoRecorded(blob: Blob) {
    setVideoOpen(false);
    const mime = baseMime(blob.type);
    const file = new File([blob], `video-${Date.now()}.${extensionFor(mime)}`, { type: mime });
    const dt = typeof DataTransfer !== 'undefined' ? new DataTransfer() : null;
    if (dt) {
      dt.items.add(file);
      addFiles(dt.files);
    } else {
      addFiles({ 0: file, length: 1, item: () => file } as unknown as FileList);
    }
  }

  // ---------- Sending ----------
  const hasContent = text.trim().length > 0;

  async function send() {
    if (!hasContent || busy || isTooLong(text, MAX_MESSAGE_CHARS)) return;
    setBusy(true);
    setError(null);
    const ok = await onSend({
      body: text.trim() || undefined,
      replyToMessageId: replyTo?.id,
    });
    setBusy(false);
    if (ok) {
      signalTyping('');
      setText('');
      cursorRef.current = null;
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
    bankedMsRef.current = 0;
    resumedAtRef.current = Date.now();
    pausedRef.current = false;
    lockedRef.current = false;
    startLevelMeter(stream);
    setElapsed(0);
    setLevels([]);
    setEmojiOpen(false);
    setRecording({ locked: false, paused: false });
    return true;
  }

  function recordedMs() {
    return bankedMsRef.current + (pausedRef.current ? 0 : Date.now() - resumedAtRef.current);
  }

  // Listens to the microphone (without recording anything extra) so the
  // waveform moves with the voice. Phones without Web Audio get a flat line.
  function startLevelMeter(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
  }

  function stopLevelMeter() {
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  function micLevel(): number {
    const analyser = analyserRef.current;
    if (!analyser) return 0.12;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.max(0.12, Math.min(1, Math.sqrt(sum / data.length) * 5));
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec || typeof rec.pause !== 'function') return;
    if (pausedRef.current) {
      rec.resume();
      resumedAtRef.current = Date.now();
      pausedRef.current = false;
    } else {
      rec.pause();
      bankedMsRef.current += Date.now() - resumedAtRef.current;
      pausedRef.current = true;
    }
    setElapsed(recordedMs());
    setRecording((r) => (r ? { ...r, paused: pausedRef.current } : r));
  }

  function lockVoice() {
    lockedRef.current = true;
    setRecording((r) => (r ? { ...r, locked: true } : r));
  }

  function finishVoice(send: boolean) {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(null);
    stopLevelMeter();
    if (!rec) return;
    const duration = recordedMs();
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

  // Tap to start recording (hands-free right away — no holding required,
  // the way the record bar's own Cancel/Send buttons expect you to stop).
  async function startRecording() {
    if (recording || busy) return;
    const ok = await startVoice();
    if (ok) lockVoice();
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
          {onNewTeaching && (
            <button type="button" onClick={onNewTeaching} className="flex flex-col items-center gap-1" data-testid="chat-new-teaching">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-2xl">📖</span>
              {t('teaching.menu')}
            </button>
          )}
        </div>
      )}

      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" data-testid="chat-gallery-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={docRef} type="file" accept="application/pdf" className="hidden" data-testid="chat-document-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

      {recording ? (
        <div className="rounded-2xl bg-white px-4 pb-3 pt-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 font-mono text-xl text-slate-800" aria-live="polite">
              {formatDuration(elapsed)}
            </span>
            <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden>
              {Array.from({ length: LIVE_BARS }, (_, i) => {
                const level = levels[levels.length - LIVE_BARS + i];
                return (
                  <span
                    key={i}
                    className={`w-[3px] shrink-0 rounded-full ${level === undefined ? 'bg-slate-200' : recording.paused ? 'bg-slate-400' : 'bg-slate-600'}`}
                    style={{ height: `${Math.round((level ?? 0.12) * 100)}%` }}
                  />
                );
              })}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {recording.paused ? t('groupChat.recording_paused') : (
              <>
                <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" aria-hidden />
                {t('groupChat.recording')}
              </>
            )}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => finishVoice(false)}
              aria-label={t('groupChat.cancel') ?? ''}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"
            >
              <ChatIcon name="trash" />
            </button>
            {typeof recorderRef.current?.pause === 'function' ? (
              <button
                type="button"
                onClick={togglePause}
                className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-slate-100 font-medium text-slate-800"
              >
                {recording.paused ? (
                  <>
                    <ChatIcon name="mic" className="h-6 w-6 text-red-600" />
                    {t('groupChat.recording_resume')}
                  </>
                ) : (
                  <>
                    <ChatIcon name="pause" />
                    {t('groupChat.recording_pause')}
                  </>
                )}
              </button>
            ) : (
              <span className="flex-1" />
            )}
            <button
              type="button"
              onClick={() => finishVoice(true)}
              aria-label={t('groupChat.send_voice') ?? ''}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
            >
              <ChatIcon name="send" />
            </button>
          </div>
        </div>
      ) : (
        <>
        {formatOpen && (
          <FormatBar
            textareaRef={textRef}
            value={text}
            onChange={(next) => {
              setText(next);
              signalTyping(next);
            }}
            className="mb-2"
          />
        )}
        <div className="flex items-end gap-2">
          <div className="flex min-h-[48px] min-w-0 flex-1 items-end rounded-3xl bg-white px-1">
            <button
              type="button"
              onClick={toggleEmoji}
              aria-label={t(emojiOpen ? 'groupChat.emoji_close' : 'groupChat.emoji_open') ?? ''}
              aria-expanded={emojiOpen}
              className="shrink-0 p-2.5 text-slate-500"
            >
              <ChatIcon name={emojiOpen ? 'keyboard' : 'smiley'} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFormatOpen((v) => !v)}
              aria-label={t(formatOpen ? 'format.hide' : 'format.show') ?? ''}
              aria-pressed={formatOpen}
              className={`shrink-0 px-1.5 py-2.5 text-sm font-semibold ${formatOpen ? 'text-emerald-700' : 'text-slate-500'}`}
            >
              Aa
            </button>
            <LiveFormatTextarea
              ref={textRef}
              wrapperClassName="min-w-0 flex-1"
              rows={1}
              value={text}
              aria-label={t('groupChat.type_message') ?? ''}
              placeholder={t('groupChat.type_message') ?? ''}
              onChange={(e) => {
                setText(e.target.value);
                resizeText(e.target);
                signalTyping(e.target.value);
                rememberCursor(e.target);
              }}
              onSelect={(e) => {
                rememberCursor(e.currentTarget);
                if (e.currentTarget.selectionEnd !== e.currentTarget.selectionStart) setFormatOpen(true);
              }}
              onFocus={() => setEmojiOpen(false)}
              onKeyDown={onKeyDown}
              className="block w-full max-h-[120px] resize-none border-0 bg-transparent px-1 py-3 text-[16px] leading-6 outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(false);
                setMenuOpen((v) => !v);
              }}
              aria-label={t('groupChat.attach') ?? ''}
              aria-expanded={menuOpen}
              className="shrink-0 -rotate-45 p-2.5 text-slate-500"
            >
              <ChatIcon name="paperclip" />
            </button>
            {!text.trim() && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                aria-label={t('groupChat.take_photo') ?? ''}
                className="shrink-0 p-2.5 text-slate-500"
              >
                <ChatIcon name="camera" />
              </button>
            )}
            <VoiceInputButton onResult={onVoiceInputResult} className="shrink-0 p-2.5 text-lg" />
          </div>

          {hasContent ? (
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || isTooLong(text, MAX_MESSAGE_CHARS)}
              aria-label={t('groupChat.send') ?? ''}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white disabled:bg-emerald-300"
            >
              <ChatIcon name="send" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={busy}
              aria-label={t('groupChat.record_voice') ?? ''}
              title={t('groupChat.record_voice') ?? ''}
              className="flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-full bg-emerald-600 text-white disabled:bg-emerald-300"
            >
              <ChatIcon name="mic" />
            </button>
          )}
        </div>
        <LengthNote value={text} max={MAX_MESSAGE_CHARS} className="px-3 pt-1" />
        </>
      )}

      {emojiOpen && !recording && (
        <Suspense fallback={<div className="mt-2 h-[300px] rounded-t-2xl bg-white" />}>
          <EmojiPanel onPick={insertEmoji} onBackspace={deleteBeforeCaret} />
        </Suspense>
      )}

      {videoOpen && <VideoRecorder onDone={onVideoRecorded} onClose={() => setVideoOpen(false)} />}

      {preview && preview.length > 0 && (
        <MediaPreview
          files={preview}
          initialCaption={text}
          maxCaption={MAX_MESSAGE_CHARS}
          canAddMore={preview.length < MAX_ATTACHMENTS_PER_MESSAGE}
          onAddMore={() => galleryRef.current?.click()}
          onRemove={(i) => setPreview((prev) => (prev && prev.length > 1 ? prev.filter((_, j) => j !== i) : null))}
          onClose={() => setPreview(null)}
          onSend={sendPreview}
        />
      )}
    </div>
  );
}
