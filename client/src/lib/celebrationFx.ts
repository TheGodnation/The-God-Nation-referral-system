// The celebration on the Congratulations page, drawn on one full-screen canvas: a shower of confetti (ribbons, discs and
// stars) that keeps falling for as long as the page is open, golden fireworks that rise from the bottom and burst into stars,
// and sparkles drifting upward. It stays in place while people scroll, so it is still falling when they reach the end.

export interface CelebrationFx {
  stop(): void;
  /** How much is on screen, for tests. */
  stats(): { confetti: number; sparks: number; rockets: number; rising: number };
}

interface Env {
  rand?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  size?: () => { w: number; h: number; dpr: number };
}

const CONFETTI = ['#f2c94c', '#e0b027', '#ffffff', '#80abff', '#2a5cf0', '#ffd98a', '#ff9f43', '#ff7eb6'];
const BURST = ['#f2c94c', '#ffe08a', '#ffffff', '#ffd166', '#80abff'];

interface Piece { x: number; y: number; vy: number; sway: number; phase: number; speed: number; size: number; rot: number; vr: number; shape: 0 | 1 | 2 | 3; color: string }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; star: boolean }
interface Rocket { x: number; y: number; vy: number; apex: number; trail: { x: number; y: number }[] }
interface Rising { x: number; y: number; vy: number; drift: number; life: number; max: number; size: number }

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function startCelebrationFx(canvas: HTMLCanvasElement, env: Env = {}): CelebrationFx {
  const rand = env.rand ?? Math.random;
  const raf = env.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const caf = env.caf ?? ((id) => window.cancelAnimationFrame(id));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {}, stats: () => ({ confetti: 0, sparks: 0, rockets: 0, rising: 0 }) };

  let W = 0;
  let H = 0;
  const measure = env.size ?? (() => ({ w: window.innerWidth, h: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) }));
  const resize = () => {
    const s = measure();
    W = s.w;
    H = s.h;
    canvas.width = Math.round(W * s.dpr);
    canvas.height = Math.round(H * s.dpr);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const between = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length) % list.length];

  const newPiece = (y: number): Piece => ({
    x: rand() * W,
    y,
    vy: between(70, 190),
    sway: between(12, 46),
    phase: rand() * Math.PI * 2,
    speed: between(1.5, 4),
    size: between(6, 13),
    rot: rand() * Math.PI * 2,
    vr: between(-5, 5),
    shape: pick<0 | 1 | 2 | 3>([0, 0, 1, 2, 3]),
    color: pick(CONFETTI),
  });

  // Plenty of pieces, spread above the screen so they pour in over the first seconds, then recycle for as long as the page is open.
  const target = Math.max(110, Math.min(240, Math.round((W * H) / 2800)));
  const confetti: Piece[] = Array.from({ length: target }, () => newPiece(-rand() * H * 1.2 - 10));
  const sparks: Spark[] = [];
  const rockets: Rocket[] = [];
  const rising: Rising[] = [];
  let nextRocket = 0.7;
  let risingBudget = 0;

  const burst = (x: number, y: number) => {
    const count = Math.round(between(34, 56));
    const ring = rand() > 0.5;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (ring ? 0 : rand() * 0.4);
      const sp = ring ? between(150, 190) : between(60, 250);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: between(1.3, 2.2), size: between(3, 7), color: pick(BURST), star: rand() > 0.35 });
    }
  };

  let last = 0;
  let id = 0;
  let stopped = false;

  const frame = (t: number) => {
    if (stopped) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    ctx.clearRect(0, 0, W, H);

    // Confetti
    for (const p of confetti) {
      p.y += p.vy * dt;
      p.phase += p.speed * dt;
      p.x += Math.sin(p.phase) * p.sway * dt;
      p.rot += p.vr * dt;
      if (p.y > H + 20) Object.assign(p, newPiece(-14));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const flutter = Math.cos(p.phase * 2);
      if (p.shape === 0) {
        ctx.scale(1, 0.35 + Math.abs(flutter) * 0.65);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 2) {
        ctx.scale(0.5 + Math.abs(flutter) * 0.5, 1);
        star(ctx, p.size * 0.8);
      } else {
        ctx.scale(1, 0.4 + Math.abs(flutter) * 0.6);
        ctx.fillRect(-p.size * 0.7, -1.5, p.size * 1.4, 3);
      }
      ctx.restore();
    }

    // Fireworks: a rocket rises from the bottom and bursts into stars near the top half of the screen.
    nextRocket -= dt;
    if (nextRocket <= 0 && rockets.length < 3) {
      const apex = between(H * 0.18, H * 0.5);
      rockets.push({ x: between(W * 0.12, W * 0.88), y: H + 10, vy: -(H + 10 - apex) / 0.95, apex, trail: [] });
      nextRocket = between(1.1, 2.4);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 12) r.trail.shift();
      r.y += r.vy * dt;
      r.vy *= 1 - 0.55 * dt;
      r.trail.forEach((pt, k) => {
        ctx.globalAlpha = (k / r.trail.length) * 0.8;
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1 + (k / r.trail.length) * 2, 0, Math.PI * 2);
        ctx.fill();
      });
      if (r.y <= r.apex) {
        burst(r.x, r.y);
        rockets.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max) {
        sparks.splice(i, 1);
        continue;
      }
      s.vx *= 1 - 0.9 * dt;
      s.vy = s.vy * (1 - 0.9 * dt) + 140 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = 1 - s.life / s.max;
      ctx.globalAlpha = Math.max(0, k) * (0.6 + 0.4 * Math.sin(s.life * 30));
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.star) {
        ctx.rotate(s.life * 3);
        star(ctx, s.size * (0.5 + k * 0.7));
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, s.size * 0.4 * (0.4 + k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sparkles drifting upward from the bottom edge, twinkling.
    risingBudget += dt * Math.max(6, W / 45);
    while (risingBudget >= 1) {
      risingBudget -= 1;
      rising.push({ x: rand() * W, y: H + 6, vy: -between(40, 120), drift: between(-14, 14), life: 0, max: between(3, 5.5), size: between(2, 4.5) });
    }
    for (let i = rising.length - 1; i >= 0; i--) {
      const r = rising[i];
      r.life += dt;
      if (r.life >= r.max || r.y < -10) {
        rising.splice(i, 1);
        continue;
      }
      r.y += r.vy * dt;
      r.x += r.drift * dt;
      ctx.globalAlpha = Math.min(1, r.life * 2) * Math.min(1, (r.max - r.life) * 1.5) * (0.5 + 0.5 * Math.sin(r.life * 9 + r.x));
      ctx.fillStyle = '#ffe9a8';
      ctx.save();
      ctx.translate(r.x, r.y);
      star(ctx, r.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    id = raf(frame);
  };
  id = raf(frame);

  return {
    stop() {
      stopped = true;
      caf(id);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, W, H);
    },
    stats: () => ({ confetti: confetti.length, sparks: sparks.length, rockets: rockets.length, rising: rising.length }),
  };
}
