import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Speech-to-text dictation for text fields — the free, zero-bundle browser
// Web Speech API (no server, no third-party key). Reliable on Chrome/
// Android (this app's majority audience); simply absent on Safari/iOS and
// some low-end WebViews, where `supported` is false and callers should
// hide the mic button rather than show a broken one.

interface SpeechRecognitionResultLike {
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** `onResult` is called once with the transcript when the person stops
 * speaking (final results only — interim results are inconsistent enough
 * across browsers to be more distracting than helpful here). */
export function useSpeechToText(onResult: (transcript: string) => void) {
  const { i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const supported = useRef(getSpeechRecognitionCtor() !== null).current;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => () => recognitionRef.current?.stop(), []);

  function start() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || listening) return;
    const recognition = new Ctor();
    recognition.lang = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) onResultRef.current(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return { supported, listening, start, stop };
}
