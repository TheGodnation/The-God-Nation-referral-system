// Turning the background noise down between words. The voice is delayed by a few hundredths of a second while a "listener" measures
// how loud it is; when only the room's hiss and hum are there, the volume is lowered a good deal, and it opens again just before the
// next word arrives (so no word starts are cut). The listener learns how noisy the room is by itself: the quietest level it has
// heard lately is taken to be the room, and anything clearly above it is taken to be speech.
//
// Safety: a gate that stayed shut would silence the voice, so each check also schedules the gate to open again a moment later. If
// the checks ever stop (a busy or sleeping phone), it opens by itself.

/** How far above the room's noise a sound must be to count as speech. */
export const GATE_MARGIN_DB = 9;
/** What the volume is lowered to between words (0.18 is about 15 dB quieter). */
export const GATE_CLOSED_GAIN = 0.18;
/** After the last bit of speech the gate stays open this long, so word endings and short pauses are not chopped. */
export const GATE_HOLD_MS = 250;
// A phone's microphone often lifts the room's noise a good deal, so the room may be taken to be quite loud.
export const GATE_FLOOR_MIN_DB = -70;
export const GATE_FLOOR_MAX_DB = -32;
export const GATE_THRESHOLD_MIN_DB = -60;
export const GATE_THRESHOLD_MAX_DB = -24;
/** The room's noise level is taken to creep up this slowly (dB per second) while a louder sound goes on. */
const FLOOR_RISE_DB_PER_S = 1;
/** The voice is delayed this long so the gate can open before the sound arrives. */
export const GATE_LOOKAHEAD_S = 0.04;
const CHECK_EVERY_MS = 20;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The decision part, with no audio in it: given how loud the last moment was, should the gate be open? */
export class GateController {
  private floor: number | null = null;
  private last: number | null = null;
  private openUntil = 0;

  update(levelDb: number, nowMs: number): { open: boolean; gain: number; floorDb: number; thresholdDb: number } {
    const dt = this.last === null ? 0 : Math.max(0, (nowMs - this.last) / 1000);
    this.last = nowMs;
    // The room's noise: a quieter moment is believed at once; a louder one only slowly.
    if (this.floor === null) this.floor = clamp(levelDb, GATE_FLOOR_MIN_DB, GATE_FLOOR_MAX_DB);
    else if (levelDb < this.floor) this.floor = Math.max(GATE_FLOOR_MIN_DB, levelDb);
    else this.floor = Math.min(GATE_FLOOR_MAX_DB, this.floor + FLOOR_RISE_DB_PER_S * dt);
    const thresholdDb = clamp(this.floor + GATE_MARGIN_DB, GATE_THRESHOLD_MIN_DB, GATE_THRESHOLD_MAX_DB);
    if (levelDb > thresholdDb) this.openUntil = nowMs + GATE_HOLD_MS;
    const open = nowMs < this.openUntil;
    return { open, gain: open ? 1 : GATE_CLOSED_GAIN, floorDb: this.floor, thresholdDb };
  }
}

export interface NoiseGate {
  /** Starts listening (call when sound starts flowing). */
  start: () => void;
  /** Stops listening and opens the gate (call when the sound stops). */
  stop: () => void;
  /** Off: the sound passes through untouched. */
  setEnabled: (on: boolean) => void;
  /** Lets go of everything. */
  dispose: () => void;
}

/**
 * Puts the gate between `input` and `output`: input → (listener) and input → delay → gate → output. Nothing is audible through the
 * listener branch; it only measures.
 */
export function insertNoiseGate(ctx: AudioContext, input: AudioNode, output: AudioNode): NoiseGate {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const delay = ctx.createDelay(0.2);
  delay.delayTime.value = GATE_LOOKAHEAD_S;
  const gate = ctx.createGain();
  input.connect(analyser);
  input.connect(delay);
  delay.connect(gate);
  gate.connect(output);

  const samples = new Float32Array(analyser.fftSize);
  const controller = new GateController();
  let timer: number | null = null;
  let enabled = true;

  const set = (target: number, timeConstant: number, reopenIn?: number) => {
    const t = ctx.currentTime;
    gate.gain.cancelScheduledValues(t);
    gate.gain.setTargetAtTime(target, t, timeConstant);
    // If nothing renews this, the gate opens again by itself.
    if (reopenIn !== undefined) gate.gain.setTargetAtTime(1, t + reopenIn, 0.01);
  };

  function check() {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const levelDb = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-9);
    const { open, gain } = controller.update(levelDb, performance.now());
    if (open) set(1, 0.008);
    else set(gain, 0.08, 0.15);
  }

  return {
    start() {
      if (timer !== null || !enabled) return;
      timer = window.setInterval(check, CHECK_EVERY_MS);
    },
    stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      set(1, 0.01);
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        set(1, 0.01);
      }
    },
    dispose() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
  };
}
