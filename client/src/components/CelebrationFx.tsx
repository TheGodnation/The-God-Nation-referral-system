import { useEffect, useRef } from 'react';
import { startCelebrationFx } from '../lib/celebrationFx';

// The celebration layer for the Congratulations page: confetti, fireworks and sparkles on a full-screen canvas that never
// blocks a tap and stays while people scroll. Not shown to people whose phone asks for less motion.
export function CelebrationFx() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fx = startCelebrationFx(canvas);
    return () => fx.stop();
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-20 h-full w-full" data-testid="celebration-fx" />;
}
