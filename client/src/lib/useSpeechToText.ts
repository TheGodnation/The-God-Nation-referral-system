import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Speech-to-text dictation for text fields — the free, zero-bundle browser
// Web Speech API (no server, no third-party key). Reliable on Chrome/
// Android (this app's majority audience); simply absent on Safari/iOS and
// some low-end WebViews, where `supported` is false and callers should
// hide the mic button rather than show a broken one.
//
// Chrome's own SpeechRecognition silently ends a session after a short
// pause in speech (often well under a minute) even with `continuous: true`
// — this is a widely-hit platform quirk, not a bug in this hook. The fix
// is to treat that `onend` as "keep going" (start a fresh recognition
// instance) rather than "the person is done", up to MAX_LISTEN_MS overall,
// so dictating a full prayer request or long message actually works.
const MAX_LISTEN_MS = 5 * 60 * 1000;

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

// Errors worth silently retrying (a pause, a dropped packet) — anything
// else (permission denied, no mic at all) stops for good rather than
// looping forever.
const RECOVERABLE_ERRORS = new Set(['no-speech', 'audio-capture', 'network']);

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** `onResult` is called with each newly finalized chunk of speech as it
 * comes in (not just once at the very end), so the caller can append it
 * live while the person keeps talking. */
export function useSpeechToText(onResult: (transcript: string) => void) {
  const { i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const supported = useRef(getSpeechRecognitionCtor() !== null).current;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const stoppedByUserRef = useRef(true);
  const startedAtRef = useRef(0);
  const maxTimerRef = useRef<number | null>(null);

  function clearMaxTimer() {
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }

  function stop() {
    stoppedByUserRef.current = true;
    clearMaxTimer();
    recognitionRef.current?.stop();
    setListening(false);
  }

  // Unmounting mid-dictation: stop the recognizer without touching state.
  useEffect(
    () => () => {
      stoppedByUserRef.current = true;
      clearMaxTimer();
      recognitionRef.current?.stop();
    },
    [],
  );

  function launch() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      let newFinal = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) newFinal += `${result[0]?.transcript ?? ''} `;
      }
      newFinal = newFinal.trim();
      if (newFinal) onResultRef.current(newFinal);
    };
    recognition.onerror = (e) => {
      if (RECOVERABLE_ERRORS.has(e.error) && !stoppedByUserRef.current && Date.now() - startedAtRef.current < MAX_LISTEN_MS) {
        return; // onend fires right after onerror — it does the actual restart.
      }
      stoppedByUserRef.current = true;
    };
    recognition.onend = () => {
      if (!stoppedByUserRef.current && Date.now() - startedAtRef.current < MAX_LISTEN_MS) {
        launch(); // The browser ended the session on its own — keep going.
        return;
      }
      clearMaxTimer();
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      stoppedByUserRef.current = true;
      setListening(false);
    }
  }

  function start() {
    if (!getSpeechRecognitionCtor() || listening) return;
    stoppedByUserRef.current = false;
    startedAtRef.current = Date.now();
    setListening(true);
    launch();
    maxTimerRef.current = window.setTimeout(stop, MAX_LISTEN_MS);
  }

  return { supported, listening, start, stop };
}
