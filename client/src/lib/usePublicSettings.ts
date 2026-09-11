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

// Section 22: Admin-editable website copy + social/support links. Content
// keys not set by Admin simply fall back to the caller's own default text —
// this is a light key/value override, not a full CMS.
export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(EMPTY);

  useEffect(() => {
    api
      .get<Omit<PublicSettings, 'loaded'>>('/api/settings/public')
      .then((data) => setSettings({ ...data, loaded: true }))
      .catch(() => setSettings((prev) => ({ ...prev, loaded: true })));
  }, []);

  return settings;
}
