import { useTranslation } from 'react-i18next';

const LANGUAGE_KEY = { en: 'common.language_en', fr: 'common.language_fr' } as const;

// The small "Translated from French — Show original" line under a
// translated post, chat message, or voice-note transcript (Facebook-style).
// Shows nothing about which direction the toggle goes except via its own
// label — callers decide what text to actually display based on
// `showingOriginal`, this is only the badge + toggle control.
export function TranslationNote({
  sourceLanguage,
  showingOriginal,
  onToggle,
  showOriginalLabel,
  showTranslationLabel,
}: {
  sourceLanguage: 'en' | 'fr';
  showingOriginal: boolean;
  onToggle: () => void;
  showOriginalLabel?: string;
  showTranslationLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {!showingOriginal && <span>{t('translation.translated_from', { language: t(LANGUAGE_KEY[sourceLanguage]) })}</span>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="font-semibold text-emerald-700 underline"
      >
        {showingOriginal ? (showTranslationLabel ?? t('translation.show_translation')) : (showOriginalLabel ?? t('translation.show_original'))}
      </button>
    </p>
  );
}
