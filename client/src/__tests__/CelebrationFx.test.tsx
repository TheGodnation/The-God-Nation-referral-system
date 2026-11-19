import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { startCelebrationFx } from '../lib/celebrationFx';
import { CelebrationFx } from '../components/CelebrationFx';

// The celebration is drawn on a canvas, which the test browser does not have: a fake drawing surface counts what is drawn.
function fakeCanvas() {
  const calls: Record<string, number> = {};
  const ctx: Record<string, unknown> = new Proxy({}, {
    get: (_t, name: string) => {
      if (name === 'canvas') return undefined;
      return (...args: unknown[]) => {
        calls[name] = (calls[name] ?? 0) + 1;
        void args;
      };
    },
    set: () => true,
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

function loop() {
  let cb: ((t: number) => void) | null = null;
  let id = 0;
  let cancelled = 0;
  return {
    raf: (f: (t: number) => void) => {
      cb = f;
      return ++id;
    },
    caf: () => {
      cancelled++;
      cb = null;
    },
    tick: (t: number) => cb?.(t),
    cancelled: () => cancelled,
    running: () => cb !== null,
  };
}

// A repeatable "random": 0.1, 0.2 ... 0.9, 0.1 ...
const seq = () => {
  let i = 0;
  return () => ((i++ % 9) + 1) / 10;
};
const size = () => ({ w: 390, h: 844, dpr: 2 });

afterEach(() => vi.unstubAllGlobals());

describe('the celebration drawing', () => {
  it('starts with a big shower of confetti, sized to the screen, and draws every frame', () => {
    const { canvas, calls } = fakeCanvas();
    const l = loop();
    const fx = startCelebrationFx(canvas, { rand: seq(), raf: l.raf, caf: l.caf, size });
    expect(canvas.width).toBe(780); // drawn at twice the sharpness on a sharp screen
    expect(canvas.height).toBe(1688);
    expect(fx.stats().confetti).toBeGreaterThanOrEqual(110); // plenty, not a sprinkle
    l.tick(0);
    l.tick(16);
    expect(calls.clearRect).toBe(2);
    expect((calls.fillRect ?? 0) + (calls.fill ?? 0)).toBeGreaterThan(100);
    fx.stop();
  });

  it('keeps falling without ever running out: pieces that reach the bottom come back at the top', () => {
    const { canvas } = fakeCanvas();
    const l = loop();
    const fx = startCelebrationFx(canvas, { rand: seq(), raf: l.raf, caf: l.caf, size });
    const count = fx.stats().confetti;
    for (let t = 0; t <= 60_000; t += 50) l.tick(t); // a full minute
    expect(fx.stats().confetti).toBe(count);
    fx.stop();
  });

  it('sends up fireworks that burst into stars, and sparkles that drift up', () => {
    const { canvas } = fakeCanvas();
    const l = loop();
    const fx = startCelebrationFx(canvas, { rand: seq(), raf: l.raf, caf: l.caf, size });
    let sawRocket = false;
    let sawBurst = false;
    let sawRising = false;
    for (let t = 0; t <= 8000; t += 33) {
      l.tick(t);
      const s = fx.stats();
      sawRocket ||= s.rockets > 0;
      sawBurst ||= s.sparks > 20;
      sawRising ||= s.rising > 0;
    }
    expect(sawRocket).toBe(true);
    expect(sawBurst).toBe(true);
    expect(sawRising).toBe(true);
    fx.stop();
  });

  it('does not let the sparks and fireworks pile up', () => {
    const { canvas } = fakeCanvas();
    const l = loop();
    const fx = startCelebrationFx(canvas, { rand: seq(), raf: l.raf, caf: l.caf, size });
    let most = 0;
    for (let t = 0; t <= 120_000; t += 50) {
      l.tick(t);
      const s = fx.stats();
      most = Math.max(most, s.sparks + s.rockets + s.rising);
    }
    expect(most).toBeLessThan(500);
    fx.stop();
  });

  it('stops cleanly: no more frames are drawn', () => {
    const { canvas, calls } = fakeCanvas();
    const l = loop();
    const fx = startCelebrationFx(canvas, { rand: seq(), raf: l.raf, caf: l.caf, size });
    l.tick(0);
    fx.stop();
    expect(l.cancelled()).toBe(1);
    expect(l.running()).toBe(false);
    const before = calls.clearRect;
    l.tick(100);
    expect(calls.clearRect).toBe(before);
  });

  it('does nothing, and does not fail, where the screen cannot draw', () => {
    const l = loop();
    const fx = startCelebrationFx({ getContext: () => null } as unknown as HTMLCanvasElement, { raf: l.raf, caf: l.caf, size });
    expect(fx.stats()).toEqual({ confetti: 0, sparks: 0, rockets: 0, rising: 0 });
    expect(() => fx.stop()).not.toThrow();
    expect(l.running()).toBe(false);
  });
});

describe('the celebration layer', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  it('is a full-screen layer that never blocks a tap', () => {
    const { getByTestId } = render(<CelebrationFx />);
    const canvas = getByTestId('celebration-fx');
    expect(canvas.className).toContain('pointer-events-none');
    expect(canvas.className).toContain('fixed');
  });

  it('does not start for people whose phone asks for less motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    render(<CelebrationFx />);
    expect(raf).not.toHaveBeenCalled();
  });
});
