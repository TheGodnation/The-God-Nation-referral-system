import { describe, it, expect } from "vitest";
import {
  ACTIVE_TICK_MS,
  IDLE_TICK_MS,
  markActivity,
  nextTickDelayMs,
} from "../lib/activity";

describe("background check pacing", () => {
  it("checks every minute while the app is in use and after a short while", () => {
    const t = Date.now();
    markActivity(t);
    expect(nextTickDelayMs(t + 1000)).toBe(ACTIVE_TICK_MS);
    expect(nextTickDelayMs(t + 10 * 60 * 1000)).toBe(ACTIVE_TICK_MS);
  });

  it("lets the database sleep when nobody has used the app for a while", () => {
    const t = Date.now();
    markActivity(t);
    expect(nextTickDelayMs(t + 10 * 60 * 1000 + 1)).toBe(IDLE_TICK_MS);
  });

  it("goes back to every minute as soon as someone uses the app", () => {
    const t = Date.now();
    markActivity(t - 60 * 60 * 1000);
    expect(nextTickDelayMs(t)).toBe(IDLE_TICK_MS);
    markActivity(t);
    expect(nextTickDelayMs(t)).toBe(ACTIVE_TICK_MS);
  });
});
