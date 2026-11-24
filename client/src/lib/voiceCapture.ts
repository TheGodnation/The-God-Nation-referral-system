import { insertNoiseGate } from './noiseGate';

// Recording a clear, loud voice note. The microphone is opened with the phone's own voice clean-up switched on (noise reduction, echo
// control and automatic gain, which lifts a quiet speaker), the recording is made at a better quality than the browser's default, and
// the background noise is turned down between words, and the voice is run through a gentle compressor (so soft and loud parts come out
// even) and a limiter (so it never crackles) before it is recorded. Where the phone's browser cannot do any of this it quietly records the plain microphone, as before.

/** Speech at 64 kbps sounds clean and a minute is only about half a megabyte. */
export const VOICE_BITRATE = 64_000;

const VOICE_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** Opens the microphone for a voice note. A refusal (no permission) is passed on; a phone that does not know the extra settings gets the plain microphone. */
export async function openMic(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
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
 * Runs the microphone through a rumble filter (low hum), a hiss filter (very high sounds, where most of the noise is and speech has
 * little), a noise gate (turns the background down between words), a gentle compressor, a little make-up gain and a limiter, ready to
 * be recorded.
 */
export function enhanceMic(raw: MediaStream): EnhancedMic {
  const plain: EnhancedMic = { stream: raw, close: () => {} };
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return plain;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(raw);
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 110;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'lowpass';
    hiss.frequency.value = 7000;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    // A small lift only: lifting more would lift the background noise with it.
    const makeUp = ctx.createGain();
    makeUp.gain.value = 1.3;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    const out = ctx.createMediaStreamDestination();
    source.connect(rumble);
    rumble.connect(hiss);
    const gate = insertNoiseGate(ctx, hiss, compressor);
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
