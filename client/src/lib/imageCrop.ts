// The arithmetic behind the crop-and-reposition screen, kept apart from the
// screen so it can be tested. Coordinates: the "frame" is the visible window
// (what the profile picture or cover will show); the picture sits behind it,
// moved by `pos` (its top-left corner inside the frame, so zero or negative)
// and scaled by `scale` (screen pixels per picture pixel).

export interface Size {
  w: number;
  h: number;
}
export interface Pos {
  x: number;
  y: number;
}

/** Facebook-style frames: profile photos are square (shown round), covers are wide. */
export const CROP_SPEC = {
  photo: { out: { w: 720, h: 720 }, round: true },
  cover: { out: { w: 1640, h: 624 }, round: false },
} as const;

/** The smallest scale at which the picture still covers the whole frame. */
export function coverScale(nat: Size, frame: Size): number {
  return Math.max(frame.w / nat.w, frame.h / nat.h);
}

/** Keeps the picture covering the frame: no empty edges. */
export function clampPos(pos: Pos, nat: Size, scale: number, frame: Size): Pos {
  const dispW = nat.w * scale;
  const dispH = nat.h * scale;
  return {
    x: Math.min(0, Math.max(frame.w - dispW, pos.x)),
    y: Math.min(0, Math.max(frame.h - dispH, pos.y)),
  };
}

/** Centres the picture in the frame. */
export function centrePos(nat: Size, scale: number, frame: Size): Pos {
  return clampPos({ x: (frame.w - nat.w * scale) / 2, y: (frame.h - nat.h * scale) / 2 }, nat, scale, frame);
}

/** Zooms about the middle of the frame, so the part you are looking at stays put. */
export function zoomAboutCentre(pos: Pos, nat: Size, oldScale: number, newScale: number, frame: Size): Pos {
  const cx = (frame.w / 2 - pos.x) / oldScale; // the picture point under the frame centre
  const cy = (frame.h / 2 - pos.y) / oldScale;
  return clampPos({ x: frame.w / 2 - cx * newScale, y: frame.h / 2 - cy * newScale }, nat, newScale, frame);
}

/** The part of the picture (in picture pixels) that is inside the frame. */
export function sourceRect(pos: Pos, scale: number, frame: Size) {
  return { sx: (0 - pos.x) / scale, sy: (0 - pos.y) / scale, sw: frame.w / scale, sh: frame.h / scale };
}
