import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface CurrentMember {
  name: string;
  email: string;
  preferredLanguage: 'en' | 'fr';
  locationCountry: string | null;
  locationCity: string | null;
  locationArea: string | null;
  locationRegion?: string | null;
  locationDivision?: string | null;
  locationSubdivision?: string | null;
  locationQuarter?: string | null;
  // false only for a brand-new sign-up who still has to fill in their
  // details; missing (older server) is treated as complete.
  profileComplete?: boolean;
  personId?: string;
  // Path of the member's own profile picture, or null when they have none.
  photoUrl?: string | null;
}

interface MemberAuthContextValue {
  member: CurrentMember | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

// Phase 3C: entirely separate from AuthContext (Admin/Leader) — its own
// state, its own API calls (/api/member/auth/*), never shares a value with
// the Admin/Leader `user` context.
const MemberAuthContext = createContext<MemberAuthContextValue>({
  member: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function MemberAuthProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get<{ member: CurrentMember | null }>('/api/member/auth/me');
      setMember(res.member);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.post('/api/member/auth/logout');
    setMember(null);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MemberAuthContext.Provider value={{ member, loading, refresh, logout }}>{children}</MemberAuthContext.Provider>;
}

export function useMemberAuth() {
  return useContext(MemberAuthContext);
}
