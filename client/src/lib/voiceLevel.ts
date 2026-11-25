// Every voice note at the same, comfortable loudness. When a note is played, its whole sound is measured once: how loud the speaking
// is (the pauses between words are left out of the measurement). A note that is quieter than the level all notes are brought to is
// lifted by one steady amount for the whole note; a note that is already loud enough is left exactly as it is. Nothing else is done:
// no noise cleaner, no change to the tone of the voice, no squeezing. A safety limiter only catches the rare peak that would crackle.
//
// A web audio player cannot go above the phone's own volume, so the lift is made by routing the note through the phone's audio
// processing. That is only ever hooked up from a tap (a phone refuses to start it otherwise and the note would play in silence), and
// if the storage that holds the voice notes does not allow it, the note simply plays the ordinary way (see the player).

/** The level (dB below full scale) the speaking in every note is brought to. */
export const TARGET_SPEECH_DB = -18;
/** The most a quiet note is lifted (12 dB is about four times as loud). */
export const MAX_LIFT_DB = 12;
/** How far a rare peak may go over full scale before the lift is held back (the limiter catches peaks up to this). */
const PEAK_ALLOWANCE_DB = 3;
/** Moments quieter than this are silence, not speech. */
const SILENCE_DB = -55;
/** The loudest share of the moments that count as speech. */
const SPEECH_SHARE = 0.5;
const FRAME_S = 0.05;

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

export interface SpeechMeasure {
  /** How loud the speaking is (dB below full scale), or null when the note is silent. */
  speechDb: number | null;
  /** How high the peaks go (0..1), ignoring the very rarest clicks. */
  peak: number;
}

/** Measures how loud the speaking in a note is. */
export function measureSpeech(samples: Float32Array, sampleRate: number): SpeechMeasure {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_S));
  const powers: number[] = [];
  const peaks: number[] = [];
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > max) max = a;
    }
    powers.push(sum / (end - start));
    peaks.push(max);
  }
  peaks.sort((a, b) => a - b);
  const peak = peaks.length ? peaks[Math.min(peaks.length - 1, Math.floor(peaks.length * 0.995))] : 0;
  const voiced = powers.filter((p) => toDb(Math.sqrt(p)) > SILENCE_DB).sort((a, b) => b - a);
  if (voiced.length === 0) return { speechDb: null, peak };
  const loudest = voiced.slice(0, Math.max(1, Math.ceil(voiced.length * SPEECH_SHARE)));
  const mean = loudest.reduce((s, p) => s + p, 0) / loudest.length;
  return { speechDb: toDb(Math.sqrt(mean)), peak };
}

/** How much (dB) to lift a note: only ever up, never more than the maximum, and never so much that its peaks would crackle. */
export function liftDb(m: SpeechMeasure): number {
  if (m.speechDb === null) return 0;
  const wanted = TARGET_SPEECH_DB - m.speechDb;
  const peakRoom = m.peak > 0 ? PEAK_ALLOWANCE_DB - toDb(m.peak) : MAX_LIFT_DB;
  return Math.max(0, Math.min(wanted, MAX_LIFT_DB, peakRoom));
}

const contextConstructor = (): typeof AudioContext | null =>
  typeof window === 'undefined' ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
const offlineConstructor = (): typeof OfflineAudioContext | null =>
  typeof window === 'undefined' ? null : (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext ?? null);

/** Whether this phone's browser can even out the loudness at all. */
export const levelSupported = (): boolean => contextConstructor() !== null && offlineConstructor() !== null;

// One shared audio context for every voice note (phones allow only a few).
let context: AudioContext | null = null;
// Set once the storage was seen to refuse the extra access the levelling needs.
let blocked = false;
export const levelBlocked = (): boolean => blocked;
export function markLevelBlocked(): void {
  blocked = true;
}

const LIFT_KEY = 'voice:lift';
const MAX_REMEMBERED = 300;
// What each note was measured at, so it is measured only once (also kept on the phone, for the next visit).
const lifts = new Map<string, number>();
const measuring = new Map<string, Promise<number>>();

function loadLifts() {
  if (lifts.size > 0) return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LIFT_KEY) ?? '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) lifts.set(k, v);
  } catch {
    // nothing remembered: measured again
  }
}
function saveLift(key: string, db: number) {
  lifts.set(key, db);
  while (lifts.size > MAX_REMEMBERED) lifts.delete(lifts.keys().next().value as string);
  try {
    window.localStorage.setItem(LIFT_KEY, JSON.stringify(Object.fromEntries(lifts)));
  } catch {
    // not remembered: fine
  }
}

/** The lift already known for this note, if it was measured before. */
export function knownLift(key: string): number | undefined {
  loadLifts();
  return lifts.get(key);
}

/** For tests: forget everything. */
export function resetLevelForTests(): void {
  context = null;
  blocked = false;
  lifts.clear();
  measuring.clear();
}

function decode(ctx: OfflineAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Older iPhones only know the callback form.
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/** Measures a note once (later calls get the same answer). Anything that goes wrong gives 0: the note is simply not lifted. */
export function measureNote(key: string, url: string): Promise<number> {
  const known = knownLift(key);
  if (known !== undefined) return Promise.resolve(known);
  const running = measuring.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const Offline = offlineConstructor();
      if (!Offline) return 0;
      const res = await fetch(url, url.startsWith('blob:') ? undefined : { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return 0;
      const data = await res.arrayBuffer();
      // Measured at a low sample rate: the loudness is the same, and a long teaching takes far less memory.
      let ctx: OfflineAudioContext;
      try {
        ctx = new Offline(1, 1, 16000);
      } catch {
        ctx = new Offline(1, 1, 44100);
      }
      const buffer = await decode(ctx, data);
      const db = liftDb(measureSpeech(buffer.getChannelData(0), buffer.sampleRate));
      saveLift(key, db);
      return db;
    } catch {
      return 0;
    } finally {
      measuring.delete(key);
    }
  })();
  measuring.set(key, job);
  return job;
}

/** Call from inside a tap: makes (and starts) the shared audio context. False when it cannot be made. */
export function primeLevel(): boolean {
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

export interface LevelGraph {
  /** Sets the note's lift (dB), moving to it smoothly. */
  setLift: (db: number) => void;
}

/**
 * Routes this audio element through one steady volume and a safety limiter. Once done, the element's sound only comes out through
 * it, so it is attempted only when the context is surely running: inside a tap (`fromTap`), or when an earlier tap already started it.
 */
export function attachLevel(audio: HTMLAudioElement, fromTap: boolean, startDb = 0): LevelGraph | null {
  const ctx = context;
  if (!ctx || ctx.state === 'closed') return null;
  if (!fromTap && ctx.state !== 'running') return null;
  try {
    const source = ctx.createMediaElementSource(audio);
    const volume = ctx.createGain();
    volume.gain.value = Math.pow(10, startDb / 20);
    // Only touches a peak that would go over the top; the rest of the voice passes untouched.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    source.connect(volume);
    volume.connect(limiter);
    limiter.connect(ctx.destination);
    return {
      setLift(db: number) {
        const target = Math.pow(10, Math.max(0, Math.min(MAX_LIFT_DB, db)) / 20);
        try {
          volume.gain.cancelScheduledValues(ctx.currentTime);
          volume.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
        } catch {
          volume.gain.value = target;
        }
      },
    };
  } catch {
    return null;
  }
}
