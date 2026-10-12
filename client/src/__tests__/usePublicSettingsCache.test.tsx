import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePublicSettings } from '../lib/usePublicSettings';

const calls: string[] = [];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: { appSloganEn: 'Raising kingdom leaders' } }),
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

// usePublicSettings is called by PageShell on every single page — without
// a cache, every in-app navigation would repeat this exact network round
// trip for no reason (see its own comment). Confirms the fix: mounting it
// twice only ever fetches once.
describe('usePublicSettings caching', () => {
  it('fetches /api/settings/public only once across multiple mounts', async () => {
    mockFetch();
    const first = renderHook(() => usePublicSettings());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    expect(first.result.current.content.appSloganEn).toBe('Raising kingdom leaders');

    const second = renderHook(() => usePublicSettings());
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.content.appSloganEn).toBe('Raising kingdom leaders');

    expect(calls.filter((u) => u.includes('/api/settings/public')).length).toBe(1);
  });
});
