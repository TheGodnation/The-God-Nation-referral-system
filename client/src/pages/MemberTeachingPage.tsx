import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { TranslationNote } from '../components/TranslationNote';
import { PdfViewer } from '../components/chat/PdfViewer';
import { TeachingResults } from '../components/teaching/TeachingResults';
import { api } from '../lib/api';
import { getAttachmentUrl } from '../lib/chatMedia';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { RichText } from '../lib/richText';

// A teaching, as a member sees it: the text and/or audio / video / PDF, then
// the quiz that opens only after the system has seen them finish (read to
// the end, listened / watched, last page reached), and the live list of
// everyone in the assembly who has finished with their scores.

interface TeachingDetail {
  id: string;
  title: string;
  text: string | null;
  // Auto-translation: the title/text in the language they were NOT written in.
  detectedLanguage: 'en' | 'fr' | null;
  titleTranslated: string | null;
  textTranslated: string | null;
  communityId: string;
  communityName: string;
  messageId: string;
  authorName: string | null;
  closesAt: string;
  mediaKind: 'AUDIO' | 'VIDEO' | 'PDF' | null;
  attachments: { id: string; originalFilename: string; mimeType: string; byteSize: number; pageCount: number | null }[];
  minReadSeconds: number;
  canManage: boolean;
  quiz: {
    assessmentId: string;
    passMark: number;
    questionCount: number;
    state: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'DONE' | 'CLOSED';
    percentage: number | null;
    passed: boolean | null;
  };
  me: { textRead: boolean; mediaFraction: number; mediaDone: boolean; completed: boolean };
}

type Me = TeachingDetail['me'];
type Quiz = TeachingDetail['quiz'];

const REPORT_EVERY_MS = 10000;

/** Share (0..1) of an audio/video that has really been played (the time ranges actually played, so skipping ahead does not count). */
export function playedFraction(el: { played: TimeRanges; duration: number }): number {
  const duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  let total = 0;
  for (let i = 0; i < el.played.length; i++) total += el.played.end(i) - el.played.start(i);
  return Math.min(1, total / duration);
}

function TrackedMedia({
  kind,
  url,
  onFraction,
}: {
  kind: 'AUDIO' | 'VIDEO';
  url: string;
  onFraction: (fraction: number) => void;
}) {
  const ref = useRef<HTMLMediaElement>(null);
  const lastSent = useRef(0);
  const report = useCallback(
    (force = false) => {
      const el = ref.current;
      if (!el) return;
      const f = playedFraction(el);
      if (f > lastSent.current + (force ? 0 : 0.02)) {
        lastSent.current = f;
        onFraction(f);
      }
    },
    [onFraction],
  );
  useEffect(() => {
    const timer = window.setInterval(() => report(), REPORT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [report]);
  const common = {
    controls: true,
    preload: 'metadata' as const,
    src: url,
    onPause: () => report(true),
    onEnded: () => report(true),
  };
  return kind === 'AUDIO' ? (
    <audio ref={ref as React.RefObject<HTMLAudioElement>} className="w-full" data-testid="teaching-audio" {...common} />
  ) : (
    <video ref={ref as React.RefObject<HTMLVideoElement>} playsInline className="max-h-80 w-full rounded-lg bg-black" data-testid="teaching-video" {...common} />
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'}`} aria-hidden>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-slate-500 line-through' : 'text-slate-800'}>{children}</span>
    </li>
  );
}

export function MemberTeachingPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const { member } = useMemberAuth();
  const [teaching, setTeaching] = useState<TeachingDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const openedAt = useRef(Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const [endSeen, setEndSeen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const sentText = useRef(false);
  // The last try to save the reading failed (no connection, or a restart on the server).
  const [saveFailed, setSaveFailed] = useState(false);

  const post = useCallback(
    (body: { textRead?: boolean; mediaFraction?: number }) =>
      api
        .post<{ me: Me; quiz: Quiz }>(`/api/teachings/${id}/progress`, body)
        .then((res) => {
          setMe(res.me);
          setQuiz((prev) => ({ ...(prev ?? ({} as Quiz)), ...res.quiz }));
          return res.me;
        })
        .catch(() => null),
    [id],
  );

  useEffect(() => {
    let alive = true;
    api
      .get<TeachingDetail>(`/api/teachings/${id}`)
      .then((d) => {
        if (!alive) return;
        setTeaching(d);
        setMe(d.me);
        setQuiz(d.quiz);
        openedAt.current = Date.now();
        // "Opened" — so the list knows they are on it.
        void post({});
      })
      .catch(() => alive && setNotFound(true));
    return () => {
      alive = false;
    };
  }, [id, post]);

  // The audio / video link.
  const media = teaching?.attachments[0];
  useEffect(() => {
    if (!teaching || !media || teaching.mediaKind === 'PDF') return;
    let alive = true;
    getAttachmentUrl(`/api/communities/${teaching.communityId}/conversation`, teaching.messageId, media.id)
      .then((u) => alive && setMediaUrl(u))
      .catch(() => alive && setMediaFailed(true));
    return () => {
      alive = false;
    };
  }, [teaching, media]);

  // Has the end of the text been reached?
  useEffect(() => {
    const el = endRef.current;
    if (!el || !teaching?.text || me?.textRead) return;
    if (typeof IntersectionObserver === 'undefined') {
      setEndSeen(true);
      return;
    }
    const obs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setEndSeen(true), { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [teaching?.text, me?.textRead, teaching]);

  // "Read" counts once the end has been reached AND the page has been open for
  // a fair reading time (the server checks that too).
  const minMs = (teaching?.minReadSeconds ?? 0) * 1000;
  useEffect(() => {
    if (!teaching?.text || me?.textRead || sentText.current) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [teaching?.text, me?.textRead]);
  const waitLeft = Math.max(0, Math.ceil((openedAt.current + minMs - now) / 1000));
  useEffect(() => {
    if (!teaching?.text || me?.textRead || !endSeen || waitLeft > 0 || sentText.current) return;
    sentText.current = true;
    // A second of slack for clock differences with the server; tried again a
    // few times if the server says it was still a little early.
    // Keeps trying (every few seconds) for as long as the page stays open, so a
    // dropped connection or a server restart never leaves the quiz shut.
    const attempt = (n: number) =>
      window.setTimeout(async () => {
        const result = await post({ textRead: true });
        setSaveFailed(!result);
        if (!result?.textRead && n < 40) attempt(n + 1);
      }, n === 0 ? 1200 : 3000);
    attempt(0);
  }, [teaching?.text, me?.textRead, endSeen, waitLeft, post]);

  // The "try again" button, if the quiz has still not opened after the end was reached.
  async function tryAgain() {
    const result = await post({ textRead: true });
    setSaveFailed(!result);
  }

  async function openPdf() {
    if (!teaching || !media) return;
    try {
      setPdfUrl(await getAttachmentUrl(`/api/communities/${teaching.communityId}/conversation`, teaching.messageId, media.id));
    } catch {
      setMediaFailed(true);
    }
  }

  const refreshKey = useMemo(() => `${me?.completed}:${quiz?.state}:${quiz?.percentage}`, [me?.completed, quiz?.state, quiz?.percentage]);

  if (notFound) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-slate-500">{t('teaching.not_found')}</p>
          <Link to="/member/chats" className="mt-4 inline-block text-brand-700 hover:underline">
            {t('teaching.back_to_chats')}
          </Link>
        </div>
      </PageShell>
    );
  }
  if (!teaching || !me || !quiz) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center text-slate-400">{t('teaching.loading')}</div>
      </PageShell>
    );
  }

  const hasText = Boolean(teaching.text);
  // A member reads it in their own language when it was written in the other one.
  const hasTranslation = Boolean(teaching.detectedLanguage && teaching.titleTranslated && teaching.detectedLanguage !== (i18n.language.startsWith('fr') ? 'fr' : 'en'));
  const translated = hasTranslation && !showOriginal;
  const displayTitle = translated ? teaching.titleTranslated! : teaching.title;
  const displayText = translated && teaching.textTranslated ? teaching.textTranslated : teaching.text;
  const kind = teaching.mediaKind;
  const mediaLabel = kind === 'AUDIO' ? t('teaching.step_listen') : kind === 'VIDEO' ? t('teaching.step_watch') : t('teaching.step_pdf');
  const closes = new Date(teaching.closesAt).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long' });

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Link to={`/member/chats/group/${teaching.communityId}`} className="text-sm text-brand-700 hover:underline">
          ← {teaching.communityName}
        </Link>

        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">📖 {t('teaching.label')}</p>
          <h1 className="mt-1 break-words text-2xl font-bold text-brand-900">{displayTitle}</h1>
          {hasTranslation && (
            <TranslationNote sourceLanguage={teaching.detectedLanguage!} showingOriginal={showOriginal} onToggle={() => setShowOriginal((v) => !v)} />
          )}
          <p className="mt-1 text-xs text-slate-500">
            {teaching.authorName ? `${teaching.authorName} · ` : ''}
            {t('teaching.quiz_until', { date: closes })}
          </p>
        </header>

        <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">{t('teaching.to_do')}</h2>
          <ul className="space-y-1.5">
            {hasText && <Step done={me.textRead}>{t('teaching.step_read')}</Step>}
            {kind && <Step done={me.mediaDone}>{mediaLabel}</Step>}
            <Step done={quiz.state === 'DONE'}>{t('teaching.step_quiz')}</Step>
          </ul>
          {me.completed ? (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800" role="status">
              ✓ {t('teaching.approved')}
            </p>
          ) : (
            <p className="text-xs text-slate-500">{t('teaching.approval_note')}</p>
          )}
        </div>

        {hasText && (
          <article className="rounded-xl bg-white p-4 shadow-sm">
            <RichText className="whitespace-pre-wrap break-words text-[17px] leading-relaxed text-slate-900" data-testid="teaching-text" text={displayText} headings comfort />
            <div ref={endRef} className="mt-4 h-1" data-testid="teaching-end" />
            {me.textRead ? (
              <p className="mt-2 text-sm font-medium text-green-700">✓ {t('teaching.text_counted')}</p>
            ) : endSeen && waitLeft > 0 ? (
              <div className="mt-2 space-y-1.5" role="status">
                <p className="text-sm text-slate-600">{t('teaching.text_wait')}</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-1000"
                    style={{ width: `${Math.min(100, Math.max(4, Math.round((1 - waitLeft / Math.max(1, minMs / 1000)) * 100)))}%` }}
                  />
                </div>
              </div>
            ) : endSeen ? (
              <div className="mt-2 space-y-1" role="status">
                <p className="text-sm text-slate-600">{saveFailed ? t('teaching.text_retry') : t('teaching.text_saving')}</p>
                <button type="button" className="text-sm font-semibold text-emerald-700 underline" onClick={() => void tryAgain()} data-testid="teaching-try-again">
                  {t('teaching.try_again')}
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">{t('teaching.text_scroll')}</p>
            )}
          </article>
        )}

        {kind && media && (
          <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
            {kind === 'PDF' ? (
              <>
                <button type="button" onClick={openPdf} className="btn-primary w-full" data-testid="teaching-open-pdf">
                  📄 {t('teaching.open_pdf')} — {media.originalFilename}
                </button>
                {me.mediaDone ? <p className="text-sm font-medium text-green-700">✓ {t('teaching.pdf_counted')}</p> : <p className="text-xs text-slate-500">{t('teaching.pdf_note')}</p>}
              </>
            ) : (
              <>
                {mediaUrl ? (
                  <TrackedMedia kind={kind} url={mediaUrl} onFraction={(f) => void post({ mediaFraction: f })} />
                ) : (
                  <p className="text-sm text-slate-500">{mediaFailed ? t('teaching.media_failed') : t('teaching.loading')}</p>
                )}
                {me.mediaDone ? (
                  <p className="text-sm font-medium text-green-700">✓ {kind === 'AUDIO' ? t('teaching.audio_counted') : t('teaching.video_counted')}</p>
                ) : (
                  <p className="text-xs text-slate-500">{t('teaching.media_note')}</p>
                )}
              </>
            )}
          </div>
        )}

        <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm" data-testid="teaching-quiz">
          <h2 className="font-semibold text-slate-900">{t('teaching.quiz_title')}</h2>
          <p className="text-xs text-slate-500">{t('teaching.quiz_info', { count: quiz.questionCount, mark: quiz.passMark })}</p>
          {quiz.state === 'LOCKED' && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">🔒 {t('teaching.quiz_locked')}</p>}
          {quiz.state === 'CLOSED' && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{t('teaching.quiz_closed')}</p>}
          {(quiz.state === 'AVAILABLE' || quiz.state === 'IN_PROGRESS') && (
            <Link to={`/member/assessments/${quiz.assessmentId}`} className="btn-primary inline-flex w-full justify-center" data-testid="teaching-start-quiz">
              {quiz.state === 'IN_PROGRESS' ? t('teaching.quiz_continue') : t('teaching.quiz_start')}
            </Link>
          )}
          {quiz.state === 'DONE' && (
            <p className={`rounded-lg px-3 py-2 text-sm font-medium ${quiz.passed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`} role="status">
              {t(quiz.passed ? 'teaching.quiz_passed' : 'teaching.quiz_failed', { percent: Math.round(quiz.percentage ?? 0) })}
            </p>
          )}
        </div>

        <TeachingResults
          teachingId={teaching.id}
          mediaKind={kind}
          hasText={hasText}
          myPersonId={member?.personId}
          canManage={teaching.canManage}
          refreshKey={refreshKey}
        />
      </section>

      {pdfUrl && <PdfViewer url={pdfUrl} name={media?.originalFilename ?? 'PDF'} onClose={() => setPdfUrl(null)} onReachedEnd={() => void post({ mediaFraction: 1 })} />}
    </PageShell>
  );
}
