import { describe, it, expect } from 'vitest';
import { centrePos, clampPos, coverScale, sourceRect, zoomAboutCentre, CROP_SPEC } from '../lib/imageCrop';

const frame = { w: 300, h: 300 };

describe('image crop geometry', () => {
  it('covers the frame: a wide picture is scaled by its height, a tall one by its width', () => {
    expect(coverScale({ w: 1200, h: 600 }, frame)).toBeCloseTo(0.5); // 600 high -> 300
    expect(coverScale({ w: 600, h: 1200 }, frame)).toBeCloseTo(0.5);
    expect(coverScale({ w: 1000, h: 1000 }, frame)).toBeCloseTo(0.3);
  });

  it('starts centred, and never leaves an empty edge', () => {
    const nat = { w: 1200, h: 600 };
    const s = coverScale(nat, frame); // 0.5 -> 600x300
    expect(centrePos(nat, s, frame)).toEqual({ x: -150, y: 0 });
    expect(clampPos({ x: 50, y: 40 }, nat, s, frame)).toEqual({ x: 0, y: 0 });
    expect(clampPos({ x: -900, y: -900 }, nat, s, frame)).toEqual({ x: -300, y: 0 });
  });

  it('zooming keeps the middle of what you see in the middle', () => {
    const nat = { w: 1000, h: 1000 };
    const s1 = coverScale(nat, frame); // 0.3
    const centre = centrePos(nat, s1, frame);
    const s2 = s1 * 2;
    const zoomed = zoomAboutCentre(centre, nat, s1, s2, frame);
    // The picture point that was under the centre is still there.
    const before = { x: (150 - centre.x) / s1, y: (150 - centre.y) / s1 };
    const after = { x: (150 - zoomed.x) / s2, y: (150 - zoomed.y) / s2 };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('works out which part of the picture is inside the frame', () => {
    const rect = sourceRect({ x: -150, y: 0 }, 0.5, frame);
    expect(rect).toEqual({ sx: 300, sy: 0, sw: 600, sh: 600 });
  });

  it('uses Facebook-like output sizes: square profile photo, wide cover', () => {
    expect(CROP_SPEC.photo.out).toEqual({ w: 720, h: 720 });
    expect(CROP_SPEC.cover.out.w / CROP_SPEC.cover.out.h).toBeGreaterThan(2.5);
    expect(CROP_SPEC.cover.out.w / CROP_SPEC.cover.out.h).toBeLessThan(2.8);
  });
});
