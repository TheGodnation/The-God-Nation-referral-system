import { describe, it, expect } from 'vitest';
import { downloadSigningWindowStart } from '../lib/storage';

// Download links are signed for fixed 3-hour windows, so the same photo
// gets the same link (and the phone reuses what it already downloaded).
describe('Download link windows', () => {
  it('gives the same start time within a window, and a new one after it', () => {
    const t = Date.UTC(2026, 9, 6, 10, 5, 0);
    const start = downloadSigningWindowStart(t).getTime();
    expect(downloadSigningWindowStart(t + 60 * 60 * 1000).getTime()).toBe(start);
    expect(start).toBeLessThanOrEqual(t);
    expect(downloadSigningWindowStart(t + 3 * 60 * 60 * 1000).getTime()).toBeGreaterThan(start);
  });
});
