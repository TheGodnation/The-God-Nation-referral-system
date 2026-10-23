import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '../lib/useSpeechToText';

// A small dictation button for a text field — distinct from the chat
// composer's own 🎤 voice-NOTE recorder (which records and sends audio);
// this one transcribes speech straight into the text itself. Renders
// nothing where the browser has no Web Speech API (Safari/iOS, some
// low-end WebViews) rather than showing a button that would just fail.
export function VoiceInputButton({ onResult, className }: { onResult: (transcript: string) => void; className?: string }) {
  const { t } = useTranslation();
  const { supported, listening, start, stop } = useSpeechToText(onResult);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      aria-label={t(listening ? 'voiceInput.stop' : 'voiceInput.start') ?? ''}
      title={t(listening ? 'voiceInput.stop' : 'voiceInput.start') ?? ''}
      className={`${className ?? 'p-2 text-lg'} ${listening ? 'text-red-600' : 'text-slate-500'}`}
    >
      {listening ? '🔴' : '🎙️'}
    </button>
  );
}
