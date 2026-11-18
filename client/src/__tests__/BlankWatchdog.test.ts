import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBlank, startBlankWatchdog } from '../lib/blankWatchdog';

describe('blank page watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('sees an empty page and a page stuck on Loading as blank, a page with text as fine', () => {
    const root = document.getElementById('root')!;
    expect(isBlank(root)).toBe(true);
    root.innerHTML = '<div data-route-loading>Loading…</div>';
    expect(isBlank(root)).toBe(true);
    root.innerHTML = '<p>Welcome</p>';
    // jsdom has no layout: innerText is undefined there, so fall back to textContent like a real page would give text
    Object.defineProperty(root, 'innerText', { value: 'Welcome', configurable: true });
    expect(isBlank(root)).toBe(false);
  });

  it('offers Reload / Fix and reload after about nine blank seconds, and removes them when the page fills in', () => {
    startBlankWatchdog();
    vi.advanceTimersByTime(6000);
    expect(document.getElementById('blank-page-help')).toBeNull();
    vi.advanceTimersByTime(3500);
    const help = document.getElementById('blank-page-help');
    expect(help).not.toBeNull();
    expect(help!.textContent).toContain('Reload / Recharger');
    expect(help!.textContent).toContain('Fix and reload');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/client-errors');

    const root = document.getElementById('root')!;
    Object.defineProperty(root, 'innerText', { value: 'Chats', configurable: true });
    vi.advanceTimersByTime(3500);
    expect(document.getElementById('blank-page-help')).toBeNull();
  });
});
