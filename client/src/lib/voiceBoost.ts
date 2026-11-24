// Playing a voice note louder than the phone's normal level. A web audio player cannot go above the phone's own volume, so the audio
// is routed through an amplifier followed by a compressor and a limiter: quiet recordings and weak speakers become clearly audible,
// and the limiter stops it from crackling. Because louder also means a louder background, the noise is turned down first (a hum and
// hiss filter, and a gate that lowers the background between words, see noiseGate), and the voice is given body and its harsh high
// range softened, so it comes out full rather than thin and sharp. Three settings, chosen with the 🔊 button on the voice note and remembered on the phone.
//
// It is only ever hooked up from a tap (a phone refuses to start audio processing otherwise and the voice note would play in
// silence), and if the storage that holds the voice notes does not allow it, the note simply plays the ordinary way (see the player).

import { insertNoiseGate } from './noiseGate';
import { voiceProcessingOn } from './voiceSettings';

export type BoostLevel = 'off' | 'loud' | 'max';
export const BOOST_LEVELS: readonly BoostLevel[] = ['off', 'loud', 'max'];
const KEY = 'voice:boost';

export function loadBoost(): BoostLevel {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'off' || v === 'loud' || v === 'max' ? v : 'loud';
  } catch {
    return 'loud';
  }
}
export function saveBoost(level: BoostLevel): void {
  try {
    window.localStorage.setItem(KEY, level);
  } catch {
    // not remembered: fine
  }
}

const contextConstructor = (): typeof AudioContext | null =>
  typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);

/** Whether the boost is in use at all: the tuning must be switched on (see voiceSettings) and this phone's browser able to do it. */
export const boostSupported = (): boolean => voiceProcessingOn() && contextConstructor() !== null;

// One shared audio context for every voice note (phones allow only a few).
let context: AudioContext | null = null;
// Set once the storage was seen to refuse the extra access the boost needs.
let blocked = false;
export const boostBlocked = (): boolean => blocked;
export function markBoostBlocked(): void {
  blocked = true;
}
/** For tests: forget everything. */
export function resetBoostForTests(): void {
  context = null;
  blocked = false;
}

/** Call from inside a tap: makes (and starts) the shared audio context. False when it cannot be made. */
export function primeBoost(): boolean {
  const Ctor = contextConstructor();
  if (!Ctor) return false;
  try {
    if (!context || context.state === 'closed') context = new Ctor();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

interface Setting {
  /** Where the low hum is cut below, and where the hiss is cut above (Hz). */
  highpass: number;
  lowpass: number;
  /** A lift (dB) in the lower voice for body and weight, and a cut (dB, negative) in the harsh high range. */
  warmth: number;
  soften: number;
  gate: boolean;
  pre: number;
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
  post: number;
}
// off: passes the sound through as it is. loud: about twice as loud, compressed so soft and loud parts even out. max: about three and
// a half times, compressed harder, for the weakest speakers (a little more "squashed" sounding, which is the price of the volume).
const SETTINGS: Record<BoostLevel, Setting> = {
  off: { highpass: 10, lowpass: 20000, warmth: 0, soften: 0, gate: false, pre: 1, threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25, post: 1 },
  loud: { highpass: 80, lowpass: 5800, warmth: 3, soften: -3, gate: true, pre: 2, threshold: -24, knee: 20, ratio: 8, attack: 0.003, release: 0.25, post: 1 },
  max: { highpass: 90, lowpass: 5000, warmth: 5, soften: -5, gate: true, pre: 3.5, threshold: -30, knee: 12, ratio: 14, attack: 0.002, release: 0.2, post: 1.15 },
};

export interface BoostGraph {
  setLevel: (level: BoostLevel) => void;
  /** Stops the noise listener (call when the note goes away). */
  dispose: () => void;
}

/**
 * Routes this audio element through the amplifier. Once done, the element's sound only comes out through it, so it is attempted
 * only when the context is surely running: inside a tap (`fromTap`), or when an earlier tap already started it.
 */
export function attachBoost(audio: HTMLAudioElement, level: BoostLevel, fromTap: boolean): BoostGraph | null {
  const ctx = context;
  if (!ctx || ctx.state === 'closed') return null;
  if (!fromTap && ctx.state !== 'running') return null;
  try {
    const source = ctx.createMediaElementSource(audio);
    const pre = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    const post = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    const hum = ctx.createBiquadFilter();
    hum.type = 'highpass';
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'lowpass';
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 220;
    const soften = ctx.createBiquadFilter();
    soften.type = 'highshelf';
    soften.frequency.value = 3500;
    source.connect(hum);
    hum.connect(hiss);
    hiss.connect(warmth);
    warmth.connect(soften);
    // The noise gate sits between the filters and the amplifier, so the background is turned down before it is made louder.
    const gate = insertNoiseGate(ctx, soften, pre);
    pre.connect(compressor);
    compressor.connect(post);
    post.connect(limiter);
    limiter.connect(ctx.destination);
    const apply = (l: BoostLevel) => {
      const s = SETTINGS[l];
      hum.frequency.value = s.highpass;
      hiss.frequency.value = s.lowpass;
      warmth.gain.value = s.warmth;
      soften.gain.value = s.soften;
      pre.gain.value = s.pre;
      compressor.threshold.value = s.threshold;
      compressor.knee.value = s.knee;
      compressor.ratio.value = s.ratio;
      compressor.attack.value = s.attack;
      compressor.release.value = s.release;
      post.gain.value = s.post;
      gate.setEnabled(s.gate);
      // Switched on while the note is playing: listen again.
      if (s.gate && !audio.paused) gate.start();
    };
    // The noise listener only runs while sound is flowing.
    audio.addEventListener('play', () => gate.start());
    audio.addEventListener('pause', () => gate.stop());
    audio.addEventListener('ended', () => gate.stop());
    apply(level);
    return { setLevel: apply, dispose: () => gate.dispose() };
  } catch {
    return null;
  }
}
