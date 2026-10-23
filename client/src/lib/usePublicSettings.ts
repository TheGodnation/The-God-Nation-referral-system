import { useEffect, useState } from 'react';
import { api } from './api';

export interface PublicSettings {
  supportWhatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  whatsappContactUrl: string | null;
  telegramUrl: string | null;
  messengerUrl: string | null;
  content: Record<string, string>;
  /** Address of the Updates banner picture, or null (viewing needs sign-in). */
  appBannerUrl?: string | null;
  homeWallpaper?: { preset: string | null; imageUrl: string | null };
  chatWallpaper?: { preset: string | null; imageUrl: string | null };
  // True once the real settings have been fetched from the server (success
  // or failure). Callers should avoid rendering content-dependent text
  // (which otherwise falls back to hardcoded default copy) until this is
  // true, so visitors don't see a flash of the wrong text before the
  // Admin's saved content swaps in.
  loaded: boolean;
}

const EMPTY: PublicSettings = {
  supportWhatsappUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
  whatsappContactUrl: null,
  telegramUrl: null,
  messengerUrl: null,
  content: {},
  loaded: false,
};

// Shared across every call site for the life of the page (module-level, not
// per-component) — PageShell mounts this on literally every page, so
// without a cache a member would re-fetch the exact same rarely-changing
// settings on every single in-app navigation. One real network round trip
// per full page load is enough; a cleared cache (e.g. after an Admin edits
// these settings mid-session) only takes effect on the next full reload,
// which matches how this data already behaved before this cache existed
// (nothing previously pushed a live update into already-mounted pages
// either).
let cached: Promise<PublicSettings> | null = null;

// Test-only escape hatch — see src/__tests__/setup.ts, which calls this in
// a global afterEach so one test's mocked /api/settings/public response can
// never leak into the next test in the same file via this module-level
// cache.
export function resetPublicSettingsCacheForTests() {
  cached = null;
}

function load(): Promise<PublicSettings> {
  if (!cached) {
    cached = api
      .get<Omit<PublicSettings, 'loaded'>>('/api/settings/public')
      .then((data) => ({ ...data, loaded: true }))
      .catch(() => {
        // Don't cache a failure — a transient blip shouldn't permanently
        // deny every later page its one chance to actually load this.
        cached = null;
        return { ...EMPTY, loaded: true };
      });
  }
  return cached;
}

// Section 22: Admin-editable website copy + social/support links. Content
// keys not set by Admin simply fall back to the caller's own default text —
// this is a light key/value override, not a full CMS.
export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    load().then((data) => {
      if (!cancelled) setSettings(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
