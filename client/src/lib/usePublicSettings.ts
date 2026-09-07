import { useEffect, useState } from 'react';
import { api } from './api';

export interface PublicSettings {
  supportWhatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  content: Record<string, string>;
}

const EMPTY: PublicSettings = {
  supportWhatsappUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
  content: {},
};

// Section 22: Admin-editable website copy + social/support links. Content
// keys not set by Admin simply fall back to the caller's own default text —
// this is a light key/value override, not a full CMS.
export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(EMPTY);

  useEffect(() => {
    api
      .get<PublicSettings>('/api/settings/public')
      .then(setSettings)
      .catch(() => {});
  }, []);

  return settings;
}
