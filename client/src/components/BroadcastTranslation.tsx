import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import type { OutgoingMessage } from './chat/ChatComposer';

export type Lang = 'en' | 'fr';
export interface SentTranslation {
  /** The language the message was written in. */
  language: Lang;
  /** The same message in the other language, as checked (and maybe corrected) by the sender. */
  body: string;
}

interface Pending {
  out: OutgoingMessage;
  original: string;
  translated: string;
  language: Lang;
}
interface Failed {
  out: OutgoingMessage;
  message: string;
}

/**
 * "Translate a message to many people, with a preview." When the people chosen read both languages, the message is not
 * sent at once: it is translated once, shown in both languages (each can be corrected, with how many people get which),
 * and sent only when the sender confirms. Each person then receives the version in their own language.
 * `sendFinal` does the actual sending.
 */
export function useTranslationPreview({
  translateUrl,
  english,
  french,
  enabled,
  sendFinal,
}: {
  translateUrl: string;
  english: number;
  french: number;
  /** Whether to go through the preview for this send (people of both languages are chosen, or the sender asked for it). */
  enabled: boolean;
  sendFinal: (out: OutgoingMessage, translation: SentTranslation | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [busy, setBusy] = useState(false);

  const translate = useCallback(
    async (text: string): Promise<{ language: Lang; translated: string }> => {
      const r = await api.post<{ detectedLanguage: Lang; translatedBody: string }>(translateUrl, { text });
      return { language: r.detectedLanguage, translated: r.translatedBody };
    },
    [translateUrl],
  );

  /** The composer's send: goes through the preview when it matters, and straight out otherwise. */
  const intercept = useCallback(
    async (out: OutgoingMessage): Promise<boolean> => {
      const text = (out.body ?? '').trim();
      if (!enabled || !text) return sendFinal(out, null);
      setBusy(true);
      setFailed(null);
      try {
        const r = await translate(text);
        setPending({ out, original: text, translated: r.translated, language: r.language });
      } catch (err) {
        setFailed({ out, message: err instanceof ApiError && err.message ? err.message : t('translatePreview.failed') });
      } finally {
        setBusy(false);
      }
      // The composer clears: the message now waits in the preview, where both texts can still be corrected.
      return true;
    },
    [enabled, sendFinal, translate, t],
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    const ok = await sendFinal({ ...pending.out, body: pending.original }, pending.translated.trim() ? { language: pending.language, body: pending.translated } : null);
    setBusy(false);
    if (ok) setPending(null);
  }, [pending, sendFinal]);

  const sendAsWritten = useCallback(async () => {
    if (!failed) return;
    setBusy(true);
    const ok = await sendFinal(failed.out, null);
    setBusy(false);
    if (ok) setFailed(null);
  }, [failed, sendFinal]);

  const retranslate = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await translate(pending.original);
      setPending({ ...pending, translated: r.translated, language: r.language });
    } catch (err) {
      setFailed({ out: pending.out, message: err instanceof ApiError && err.message ? err.message : t('translatePreview.failed') });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, [pending, translate, t]);

  const panel =
    pending || failed ? (
      <PreviewPanel
        pending={pending}
        failed={failed}
        english={english}
        french={french}
        busy={busy}
        onOriginal={(v) => pending && setPending({ ...pending, original: v })}
        onTranslated={(v) => pending && setPending({ ...pending, translated: v })}
        onConfirm={() => void confirm()}
        onRetranslate={() => void retranslate()}
        onSendAsWritten={() => void sendAsWritten()}
        onCancel={() => {
          setPending(null);
          setFailed(null);
        }}
      />
    ) : null;

  return { intercept, panel, busy };
}

function PreviewPanel({
  pending,
  failed,
  english,
  french,
  busy,
  onOriginal,
  onTranslated,
  onConfirm,
  onRetranslate,
  onSendAsWritten,
  onCancel,
}: {
  pending: Pending | null;
  failed: Failed | null;
  english: number;
  french: number;
  busy: boolean;
  onOriginal: (v: string) => void;
  onTranslated: (v: string) => void;
  onConfirm: () => void;
  onRetranslate: () => void;
  onSendAsWritten: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const name = (l: Lang) => t(l === 'fr' ? 'common.language_fr' : 'common.language_en');
  return (
    <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3" data-testid="translation-preview">
      <h3 className="font-semibold text-brand-900">{t('translatePreview.title')}</h3>
      {failed && (
        <div className="space-y-2" role="alert">
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{failed.message}</p>
          <p className="text-sm text-slate-700">{t('translatePreview.failed_help')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onSendAsWritten} className="btn-primary" data-testid="preview-send-as-written">{t('translatePreview.send_as_written')}</button>
            <button type="button" onClick={onCancel} className="btn-secondary">{t('translatePreview.cancel')}</button>
          </div>
        </div>
      )}
      {pending && (() => {
        const other: Lang = pending.language === 'fr' ? 'en' : 'fr';
        const readersOriginal = pending.language === 'en' ? english : french;
        const readersOther = pending.language === 'en' ? french : english;
        return (
          <>
            <p className="text-xs text-slate-600">{t('translatePreview.hint')}</p>
            <label className="block text-sm font-medium text-slate-700">
              {t('translatePreview.written', { language: name(pending.language) })} · {t('translatePreview.goes_to', { count: readersOriginal })}
              <textarea value={pending.original} onChange={(e) => onOriginal(e.target.value)} rows={3} className="input mt-1" data-testid="preview-original" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t('translatePreview.translation', { language: name(other) })} · {t('translatePreview.goes_to', { count: readersOther })}
              <textarea value={pending.translated} onChange={(e) => onTranslated(e.target.value)} rows={3} className="input mt-1" data-testid="preview-translated" />
            </label>
            {readersOther === 0 && <p className="text-xs text-slate-600">{t('translatePreview.same_language', { language: name(pending.language) })}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !pending.original.trim()} onClick={onConfirm} className="btn-primary disabled:opacity-50" data-testid="preview-send">{t('translatePreview.send')}</button>
              <button type="button" disabled={busy} onClick={onRetranslate} className="btn-secondary" data-testid="preview-retranslate">{t('translatePreview.translate_again')}</button>
              <button type="button" onClick={onCancel} className="btn-secondary" data-testid="preview-cancel">{t('translatePreview.cancel')}</button>
            </div>
          </>
        );
      })()}
    </section>
  );
}

/** The sender's choice: translate for each person's language (on by default when both languages are chosen). */
export function TranslateToggle({ mixed, value, onChange }: { mixed: boolean; value: boolean | null; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const on = value ?? mixed;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid="translate-toggle" />
      {t('translatePreview.toggle')}
    </label>
  );
}
