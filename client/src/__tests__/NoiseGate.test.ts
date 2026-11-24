import { describe, it, expect, vi, afterEach } from 'vitest';
import { GATE_CLOSED_GAIN, GATE_FLOOR_MAX_DB, GATE_FLOOR_MIN_DB, GATE_HOLD_MS, GATE_LOOKAHEAD_S, GATE_MARGIN_DB, GATE_THRESHOLD_MAX_DB, GATE_THRESHOLD_MIN_DB, GateController, insertNoiseGate } from '../lib/noiseGate';

// Turning the background noise down between words, without cutting the voice.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('The gate’s decisions', () => {
  it('learns how noisy the room is and treats what is clearly above it as speech', () => {
    const g = new GateController();
    // A room whose hiss is at -55 dB.
    for (let t = 0; t < 1000; t += 20) {
      const r = g.update(-55, t);
      expect(r.open).toBe(false);
      expect(r.gain).toBe(GATE_CLOSED_GAIN);
    }
    const r = g.update(-55, 1000);
    expect(r.floorDb).toBe(-55);
    expect(r.thresholdDb).toBe(-55 + GATE_MARGIN_DB);
    // Speech at -30 dB opens it at once.
    expect(g.update(-30, 1020)).toMatchObject({ open: true, gain: 1 });
  });

  it('stays open through short pauses and word endings, and closes after the hold time', () => {
    const g = new GateController();
    g.update(-55, 0);
    g.update(-30, 20); // speech
    expect(g.update(-55, 20 + GATE_HOLD_MS - 20).open).toBe(true); // a short pause: still open
    expect(g.update(-55, 20 + GATE_HOLD_MS + 20).open).toBe(false); // a real gap: closed
    expect(g.update(-30, 600).open).toBe(true); // and open again for the next word
  });

  it('believes a quieter moment at once (the room is quieter than thought) but a louder one only slowly', () => {
    const g = new GateController();
    g.update(-45, 0);
    expect(g.update(-60, 20).floorDb).toBe(-60);
    // A sustained louder sound raises the room estimate by about 1 dB a second only.
    const rising = new GateController();
    rising.update(-65, 0);
    expect(rising.update(-50, 1000).floorDb).toBeCloseTo(-64, 5);
    expect(rising.update(-50, 11000).floorDb).toBeCloseTo(-54, 5);
  });

  it('keeps sensible limits: a silent file does not make every little noise count as speech, and a very noisy room does not shut out speech', () => {
    const silent = new GateController();
    silent.update(-120, 0);
    const quietRoom = silent.update(-120, 20);
    expect(quietRoom.floorDb).toBe(GATE_FLOOR_MIN_DB);
    expect(quietRoom.thresholdDb).toBe(GATE_THRESHOLD_MIN_DB); // not lower than this
    expect(silent.update(-75, 40).open).toBe(false); // faint noise: closed
    expect(silent.update(-45, 60).open).toBe(true); // a quiet voice: open

    const noisy = new GateController();
    noisy.update(-10, 0); // started during loud speech or a very loud room
    const r = noisy.update(-10, 20);
    expect(r.floorDb).toBe(GATE_FLOOR_MAX_DB); // not higher than this
    expect(r.thresholdDb).toBe(GATE_THRESHOLD_MAX_DB);
    expect(r.open).toBe(true);
  });

  it('a microphone that lifts the room’s noise to -35 dB still has that noise turned down between words', () => {
    const g = new GateController();
    for (let t = 0; t < 1000; t += 20) g.update(-35, t);
    expect(g.update(-35, 1000)).toMatchObject({ open: false, gain: GATE_CLOSED_GAIN });
    expect(g.update(-18, 1020).open).toBe(true); // speech still opens it
  });

  it('turns the noise down by about 15 dB', () => {
    expect(20 * Math.log10(GATE_CLOSED_GAIN)).toBeCloseTo(-14.9, 0);
  });
});

describe('The gate in the audio', () => {
  function setUp() {
    let amplitude = 0.002; // -54 dB: only the room
    const gainNode = { gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } };
    const analyser = {
      fftSize: 0,
      connect: vi.fn(),
      getFloatTimeDomainData: (buf: Float32Array) => buf.fill(amplitude),
    };
    const delay = { delayTime: { value: 0 }, connect: vi.fn() };
    const ctx = { currentTime: 10, createAnalyser: () => analyser, createDelay: vi.fn(() => delay), createGain: () => ({ ...gainNode, connect: vi.fn() }) } as unknown as AudioContext;
    // The gain node's own connect is replaced above, so keep a reference to the object the gate really uses.
    const used = { gain: gainNode.gain, connect: vi.fn() };
    (ctx as unknown as { createGain: () => unknown }).createGain = () => used;
    const input = { connect: vi.fn() } as unknown as AudioNode;
    const output = {} as AudioNode;
    const gate = insertNoiseGate(ctx, input, output);
    return { gate, input, analyser, delay, used, gainParam: gainNode.gain, set: (a: number) => (amplitude = a), output };
  }

  it('measures the voice and plays it from a short delay, so the gate can open before a word arrives', () => {
    const { input, analyser, delay, used, output } = setUp();
    expect(input.connect).toHaveBeenCalledWith(analyser); // the listener
    expect(input.connect).toHaveBeenCalledWith(delay); // the sound itself, delayed
    expect(delay.delayTime.value).toBe(GATE_LOOKAHEAD_S);
    expect(delay.connect).toHaveBeenCalledWith(used);
    expect(used.connect).toHaveBeenCalledWith(output);
  });

  it('turns the room noise down, opens for speech, and always schedules itself to open again', () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { gate, gainParam, set } = setUp();
    gate.start();
    // Only the room: closed (10 dB quieter), with a reopening scheduled in case nothing renews it.
    now = 20;
    vi.advanceTimersByTime(20);
    const calls = () => gainParam.setTargetAtTime.mock.calls.map((c) => [c[0], c[2]]);
    expect(calls()).toContainEqual([GATE_CLOSED_GAIN, 0.08]);
    expect(calls()).toContainEqual([1, 0.01]); // the failsafe: opens again by itself
    expect(gainParam.cancelScheduledValues).toHaveBeenCalled();
    // A word: open at once.
    set(0.1);
    now = 40;
    vi.advanceTimersByTime(20);
    expect(calls()[calls().length - 1]).toEqual([1, 0.008]);
    gate.dispose();
  });

  it('stops listening and opens when the sound stops, and can be switched off', () => {
    vi.useFakeTimers();
    const { gate, gainParam } = setUp();
    gate.start();
    gate.start(); // starting twice does not listen twice
    vi.advanceTimersByTime(100);
    const checks = gainParam.cancelScheduledValues.mock.calls.length;
    expect(checks).toBe(5);
    gate.stop();
    expect(gainParam.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, 0.01); // open
    vi.advanceTimersByTime(100);
    expect(gainParam.cancelScheduledValues.mock.calls.length).toBe(checks + 1); // only the opening, no more checks
    gate.setEnabled(false);
    gate.start(); // off: it does not start
    vi.advanceTimersByTime(100);
    expect(gainParam.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, 0.01);
    gate.dispose();
  });
});
