import { insertNoiseGate } from './noiseGate';
import { voiceProcessingOn } from './voiceSettings';
import { isInAppBrowser } from './installPrompt';
import { reportClientError } from './reportError';

// (The clean-up is switched off, see voiceSettings: the plain microphone is recorded, with the phone's own voice cleaner, at 64 kbps.)
// Recording a clear, loud voice note. The microphone is opened with the phone's own voice clean-up switched on (noise reduction, echo
// control and automatic gain, which lifts a quiet speaker), the recording is made at a better quality than the browser's default, and
// the background noise is turned down between words, and the voice is run through a gentle compressor (so soft and loud parts come out
// even) and a limiter (so it never crackles) before it is recorded. Where the phone's browser cannot do any of this it quietly records the plain microphone, as before.

/** Speech at 64 kbps sounds clean and a minute is only about half a megabyte. */
export const VOICE_BITRATE = 64_000;

/** The recording quality for a chat voice note: 64 kbps, clear and natural (the voice itself is not processed, see voiceSettings). */
export const chatBitrate = (): number => VOICE_BITRATE;
/** The recording quality for a teaching recording: the same 64 kbps, so every phone records teachings equally clearly. */
export const teachingBitrate = (): number => VOICE_BITRATE;

const VOICE_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/**
 * Why the microphone could not be opened, so the member is told the real reason (not always "blocked"):
 *  - denied: the permission was refused (by the person, or by the app the page is opened in, e.g. a link opened inside WhatsApp)
 *  - busy:   another app is using the microphone (a call, a WhatsApp voice note, a recorder) or the phone could not start it
 *  - none:   no microphone was found
 *  - other:  anything else
 */
export type MicProblem = 'denied' | 'busy' | 'none' | 'other';

export function micProblem(err: unknown): MicProblem {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'none';
  return 'other';
}

/** The message (translation key) for a microphone that could not be opened. */
export function micProblemKey(problem: MicProblem): string {
  if (problem === 'denied') return isInAppBrowser() ? 'groupChat.mic_in_app' : 'groupChat.mic_denied';
  if (problem === 'busy') return 'groupChat.mic_busy';
  if (problem === 'none') return 'groupChat.mic_none';
  return 'groupChat.mic_other';
}

/** Tells the server (it only logs it) what went wrong with the microphone, so a problem on a member's phone can be seen. */
export function reportMicProblem(err: unknown, where: 'chat' | 'teaching'): void {
  const e = err as { name?: string; message?: string } | null;
  reportClientError('mic', { message: `${where}: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}` });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the microphone for a voice note. A refusal (no permission) is passed on; a phone that does not know the extra settings gets
 * the plain microphone. When the microphone is only busy (it was still being let go by the last recording, or the phone was slow to
 * start it), it is tried once more a moment later before giving up.
 */
export async function openMic(): Promise<MediaStream> {
  try {
    return await openMicOnce();
  } catch (err) {
    if (micProblem(err) !== 'busy') throw err;
    await wait(600);
    return openMicOnce();
  }
}

async function openMicOnce(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  // As before the tuning: the plain microphone.
  if (!voiceProcessingOn()) return devices.getUserMedia({ audio: true });
  try {
    return await devices.getUserMedia({ audio: VOICE_CONSTRAINTS });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') throw err;
    return devices.getUserMedia({ audio: true });
  }
}

export interface EnhancedMic {
  /** What to record: the microphone after the clean-up (or the plain microphone when that was not possible). */
  stream: MediaStream;
  /** Lets go of the audio processing when the recording is over. The microphone itself is stopped by the caller. */
  close: () => void;
}

/**
 * Runs the microphone through a rumble filter, a hiss filter (the very high sounds, where most of the noise is), a warmth lift in the
 * lower voice and a softening of the harsh high range (so the voice is full, not thin and sharp), a noise gate (turns the background
 * down between words), a compressor, a little make-up gain and a limiter, ready to be recorded.
 */
export function enhanceMic(raw: MediaStream): EnhancedMic {
  const plain: EnhancedMic = { stream: raw, close: () => {} };
  if (!voiceProcessingOn()) return plain;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return plain;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(raw);
    // Only the real rumble is cut: the low part of the voice is what gives it body and weight.
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 75;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'lowpass';
    hiss.frequency.value = 6000;
    // Warmth: a lift in the lower voice (the "bold, heavy" part), and a softening of the harsh high range.
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 220;
    warmth.gain.value = 4;
    const soften = ctx.createBiquadFilter();
    soften.type = 'highshelf';
    soften.frequency.value = 3500;
    soften.gain.value = -4;
    // A firmer compressor makes the voice denser and fuller.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    // A small lift only: lifting more would lift the background noise with it.
    const makeUp = ctx.createGain();
    makeUp.gain.value = 1.35;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    const out = ctx.createMediaStreamDestination();
    source.connect(rumble);
    rumble.connect(hiss);
    hiss.connect(warmth);
    warmth.connect(soften);
    const gate = insertNoiseGate(ctx, soften, compressor);
    compressor.connect(makeUp);
    makeUp.connect(limiter);
    limiter.connect(out);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (!out.stream || out.stream.getAudioTracks().length === 0) {
      gate.dispose();
      void ctx.close().catch(() => {});
      return plain;
    }
    gate.start();
    return {
      stream: out.stream,
      close: () => {
        gate.dispose();
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return plain;
  }
}
